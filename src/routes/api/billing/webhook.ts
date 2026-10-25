import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { hmacSha256Hex, safeEqual } from "@/lib/billing/razorpay.server";
import { recordProductEvent } from "@/lib/analytics.server";

export const Route = createFileRoute("/api/billing/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
        const signature = request.headers.get("x-razorpay-signature") ?? "";
        if (!secret) return Response.json({ error: "Webhook is not configured." }, { status: 503 });
        const raw = await request.text();
        if (!safeEqual(await hmacSha256Hex(secret, raw), signature))
          return Response.json({ error: "Invalid webhook signature." }, { status: 400 });
        const event = JSON.parse(raw) as {
          event?: string;
          payload?: {
            subscription?: {
              entity?: {
                id?: string;
                current_end?: number;
                notes?: { lord_user_id?: string; plan?: string };
              };
            };
            payment?: { entity?: { id?: string; amount?: number; subscription_id?: string } };
          };
        };
        const subscription = event.payload?.subscription?.entity;
        const payment = event.payload?.payment?.entity;
        if (event.event === "subscription.charged" && subscription?.id && payment?.id) {
          const userId = subscription.notes?.lord_user_id;
          const endsAt = subscription.current_end
            ? new Date(subscription.current_end * 1000).toISOString()
            : null;
          if (!userId || !endsAt)
            return Response.json({ error: "Missing subscription metadata." }, { status: 400 });
          const { error: billingError } = await supabaseAdmin.from("pro_billing_events").upsert(
            {
              user_id: userId,
              razorpay_subscription_id: subscription.id,
              razorpay_payment_id: payment.id,
              event_type: event.event,
              amount: payment.amount ?? null,
              currency: "INR",
            },
            { onConflict: "razorpay_payment_id" },
          );
          if (billingError) throw billingError;
          const { data: previousEntitlement, error: entitlementLookupError } = await supabaseAdmin
            .from("pro_entitlements")
            .select("status")
            .eq("user_id", userId)
            .eq("razorpay_subscription_id", subscription.id)
            .maybeSingle();
          if (entitlementLookupError) throw entitlementLookupError;
          const { error } = await supabaseAdmin
            .from("pro_entitlements")
            .update({ status: "active", expires_at: endsAt, updated_at: new Date().toISOString() })
            .eq("user_id", userId)
            .eq("razorpay_subscription_id", subscription.id);
          if (error) throw error;
          if (previousEntitlement?.status === "inactive")
            await recordProductEvent(userId, {
              event: "subscription_checkout_confirmed",
              feature: "other",
              dedupeKey: `razorpay:${payment.id}`,
            }).catch(() => undefined);
        } else if (
          ["subscription.halted", "subscription.cancelled", "subscription.completed"].includes(
            event.event ?? "",
          ) &&
          subscription?.id
        ) {
          const status = event.event === "subscription.cancelled" ? "cancelled" : "expired";
          await supabaseAdmin
            .from("pro_entitlements")
            .update({ status, updated_at: new Date().toISOString() })
            .eq("razorpay_subscription_id", subscription.id);
        }
        return Response.json({ received: true });
      },
    },
  },
});
