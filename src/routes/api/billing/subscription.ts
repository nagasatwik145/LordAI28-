import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { razorpayCredentials } from "@/lib/billing/razorpay.server";
import { LORD_PRO_ENABLED } from "@/lib/billing/entitlements.server";
import { recordProductEvent } from "@/lib/analytics.server";

export const Route = createFileRoute("/api/billing/subscription")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      POST: async ({ request, context }) => {
        if (!LORD_PRO_ENABLED)
          return Response.json(
            { error: "LORD Pro subscriptions are temporarily unavailable." },
            { status: 503 },
          );
        const auth = context as {
          userId: string;
          claims: { email?: string; email_confirmed_at?: string | null };
        };
        if (!auth.claims?.email_confirmed_at)
          return Response.json({ error: "A verified email is required." }, { status: 403 });
        const body = (await request.json().catch(() => null)) as { plan?: string } | null;
        if (body?.plan !== "monthly" && body?.plan !== "yearly")
          return Response.json({ error: "Choose a valid plan." }, { status: 400 });
        try {
          const { data: pendingPhonePeOrder, error: pendingPhonePeError } = await supabaseAdmin
            .from("phonepe_orders")
            .select("merchant_order_id,created_at")
            .eq("user_id", auth.userId)
            .eq("status", "pending")
            .maybeSingle();
          if (pendingPhonePeError) throw pendingPhonePeError;
          if (pendingPhonePeOrder) {
            if (Date.parse(pendingPhonePeOrder.created_at) > Date.now() - 20 * 60 * 1000)
              return Response.json(
                { error: "A PhonePe checkout is already pending for this account." },
                { status: 409 },
              );
            const { error: expireError } = await supabaseAdmin
              .from("phonepe_orders")
              .update({ status: "failed" })
              .eq("merchant_order_id", pendingPhonePeOrder.merchant_order_id)
              .eq("status", "pending");
            if (expireError) throw expireError;
          }

          const { keyId, keySecret } = razorpayCredentials();
          const planId =
            body.plan === "monthly"
              ? process.env.RAZORPAY_MONTHLY_PLAN_ID
              : process.env.RAZORPAY_YEARLY_PLAN_ID;
          if (!planId)
            return Response.json(
              { error: "Razorpay plan IDs are not configured." },
              { status: 503 },
            );
          const price = Number(
            body.plan === "monthly"
              ? (process.env.LORD_PRO_MONTHLY_PRICE_INR ?? 99)
              : (process.env.LORD_PRO_YEARLY_PRICE_INR ?? 990),
          );
          const planResponse = await fetch(
            `https://api.razorpay.com/v1/plans/${encodeURIComponent(planId)}`,
            { headers: { Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}` } },
          );
          const planDetails = (await planResponse.json()) as {
            period?: string;
            interval?: number;
            item?: { amount?: number; currency?: string };
          };
          const expectedPeriod = body.plan === "monthly" ? "monthly" : "yearly";
          if (
            !planResponse.ok ||
            planDetails.period !== expectedPeriod ||
            planDetails.interval !== 1 ||
            planDetails.item?.currency !== "INR" ||
            planDetails.item?.amount !== price * 100
          ) {
            return Response.json(
              { error: "The configured Razorpay plan does not match LORD Pro pricing." },
              { status: 503 },
            );
          }
          const response = await fetch("https://api.razorpay.com/v1/subscriptions", {
            method: "POST",
            headers: {
              Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              plan_id: planId,
              total_count: body.plan === "monthly" ? 120 : 10,
              expire_by: Math.floor(Date.now() / 1000) + 20 * 60,
              quantity: 1,
              customer_notify: 1,
              notes: { lord_user_id: auth.userId, plan: body.plan },
            }),
          });
          const subscription = (await response.json()) as {
            id?: string;
            short_url?: string;
            status?: string;
            error?: { description?: string };
          };
          if (!response.ok || !subscription.id)
            return Response.json(
              { error: subscription.error?.description ?? "Could not create subscription." },
              { status: 502 },
            );
          const { error } = await supabaseAdmin.from("pro_entitlements").upsert(
            {
              user_id: auth.userId,
              status: "inactive",
              plan: body.plan,
              razorpay_subscription_id: subscription.id,
              expires_at: null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" },
          );
          if (error) throw error;
          await recordProductEvent(auth.userId, {
            event: "subscription_checkout_initiated",
            feature: "other",
          }).catch(() => undefined);
          return Response.json({
            subscriptionId: subscription.id,
            keyId,
            status: subscription.status,
          });
        } catch (error) {
          console.error(
            "[billing] subscription creation failed",
            error instanceof Error ? error.message : "unknown",
          );
          return Response.json(
            { error: error instanceof Error ? error.message : "Billing unavailable." },
            { status: 503 },
          );
        }
      },
    },
  },
});
