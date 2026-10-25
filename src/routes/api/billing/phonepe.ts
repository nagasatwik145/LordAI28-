import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { LORD_PRO_ENABLED } from "@/lib/billing/entitlements.server";
import {
  createPhonePePayment,
  getPhonePePaymentStatus,
  isPhonePeConfigured,
} from "@/lib/billing/phonepe.server";
import { recordProductEvent } from "@/lib/analytics.server";

type BillingAuth = {
  userId: string;
  claims: { email_confirmed_at?: string | null };
};

function planPrice(plan: "monthly" | "yearly"): number {
  return Number(
    plan === "monthly"
      ? (process.env.LORD_PRO_MONTHLY_PRICE_INR ?? 99)
      : (process.env.LORD_PRO_YEARLY_PRICE_INR ?? 990),
  );
}

export const Route = createFileRoute("/api/billing/phonepe")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      POST: async ({ request, context }) => {
        if (!LORD_PRO_ENABLED)
          return Response.json({ error: "LORD Pro is unavailable." }, { status: 503 });
        const auth = context as BillingAuth;
        if (!auth.claims?.email_confirmed_at)
          return Response.json({ error: "A verified email is required." }, { status: 403 });
        if (!isPhonePeConfigured())
          return Response.json(
            { error: "PhonePe sandbox checkout is not fully configured." },
            { status: 503 },
          );

        const body = (await request.json().catch(() => null)) as { plan?: string } | null;
        if (body?.plan !== "monthly" && body?.plan !== "yearly")
          return Response.json({ error: "Choose a valid plan." }, { status: 400 });
        const plan = body.plan;
        const price = planPrice(plan);
        if (!Number.isSafeInteger(price) || price <= 0 || !Number.isSafeInteger(price * 100))
          return Response.json({ error: "The configured plan price is invalid." }, { status: 503 });
        const appBaseUrl = process.env.APP_BASE_URL;
        if (!appBaseUrl)
          return Response.json({ error: "APP_BASE_URL is not configured." }, { status: 503 });
        let appUrl: URL;
        try {
          appUrl = new URL(appBaseUrl);
        } catch {
          return Response.json({ error: "APP_BASE_URL must be a valid URL." }, { status: 503 });
        }
        if (appUrl.protocol !== "https:" && appUrl.hostname !== "localhost")
          return Response.json({ error: "APP_BASE_URL must use HTTPS." }, { status: 503 });
        if (appUrl.username || appUrl.password)
          return Response.json(
            { error: "APP_BASE_URL must not contain credentials." },
            { status: 503 },
          );

        try {
          const { data: entitlement, error: entitlementError } = await supabaseAdmin
            .from("pro_entitlements")
            .select("status,expires_at,razorpay_subscription_id,updated_at")
            .eq("user_id", auth.userId)
            .maybeSingle();
          if (entitlementError) throw entitlementError;
          if (
            (entitlement?.status === "active" || entitlement?.status === "cancelled") &&
            entitlement.expires_at &&
            Date.parse(entitlement.expires_at) > Date.now()
          )
            return Response.json(
              { error: "LORD Pro is already active on this account." },
              { status: 409 },
            );
          if (entitlement?.status === "inactive" && entitlement.razorpay_subscription_id) {
            if (Date.parse(entitlement.updated_at) > Date.now() - 20 * 60 * 1000)
              return Response.json(
                { error: "A Razorpay checkout is already pending for this account." },
                { status: 409 },
              );
            const { error: expireError } = await supabaseAdmin
              .from("pro_entitlements")
              .update({ razorpay_subscription_id: null })
              .eq("user_id", auth.userId)
              .eq("razorpay_subscription_id", entitlement.razorpay_subscription_id);
            if (expireError) throw expireError;
          }

          const { data: pendingOrder, error: pendingError } = await supabaseAdmin
            .from("phonepe_orders")
            .select("merchant_order_id,created_at")
            .eq("user_id", auth.userId)
            .eq("status", "pending")
            .maybeSingle();
          if (pendingError) throw pendingError;
          if (pendingOrder) {
            if (Date.parse(pendingOrder.created_at) > Date.now() - 20 * 60 * 1000)
              return Response.json(
                { error: "A PhonePe checkout is already pending for this account." },
                { status: 409 },
              );
            const { error: expireError } = await supabaseAdmin
              .from("phonepe_orders")
              .update({ status: "failed" })
              .eq("merchant_order_id", pendingOrder.merchant_order_id)
              .eq("status", "pending");
            if (expireError) throw expireError;
          }

          const merchantOrderId = `lordpro_${crypto.randomUUID()}`;
          const { error: insertError } = await supabaseAdmin.from("phonepe_orders").insert({
            merchant_order_id: merchantOrderId,
            user_id: auth.userId,
            plan,
            amount: price * 100,
            status: "pending",
          });
          if (insertError) throw insertError;
          await recordProductEvent(auth.userId, {
            event: "subscription_checkout_initiated",
            feature: "other",
          }).catch(() => undefined);

          const redirectUrl = new URL("/upgrade", appUrl.origin);
          redirectUrl.searchParams.set("phonepeOrder", merchantOrderId);
          let checkoutUrl: string;
          try {
            checkoutUrl = await createPhonePePayment({
              merchantOrderId,
              amount: price * 100,
              message: `LORD Pro ${plan}`,
              redirectUrl: redirectUrl.toString(),
            });
          } catch (error) {
            const { error: updateError } = await supabaseAdmin
              .from("phonepe_orders")
              .update({ status: "failed" })
              .eq("merchant_order_id", merchantOrderId);
            if (updateError) throw updateError;
            throw error;
          }
          return Response.json({ checkoutUrl }, { headers: { "Cache-Control": "no-store" } });
        } catch (error) {
          console.error(
            "[billing] PhonePe checkout creation failed",
            error instanceof Error ? error.message : "unknown",
          );
          return Response.json(
            { error: error instanceof Error ? error.message : "PhonePe checkout unavailable." },
            { status: 503 },
          );
        }
      },
      GET: async ({ request, context }) => {
        if (!LORD_PRO_ENABLED)
          return Response.json({ error: "LORD Pro is unavailable." }, { status: 503 });
        const auth = context as BillingAuth;
        if (!auth.claims?.email_confirmed_at)
          return Response.json({ error: "A verified email is required." }, { status: 403 });
        const merchantOrderId = new URL(request.url).searchParams.get("merchantOrderId");
        if (!merchantOrderId || !/^lordpro_[0-9a-f-]{36}$/i.test(merchantOrderId))
          return Response.json({ error: "Invalid PhonePe order." }, { status: 400 });

        try {
          const { data: order, error } = await supabaseAdmin
            .from("phonepe_orders")
            .select("merchant_order_id,user_id,plan,amount,status")
            .eq("merchant_order_id", merchantOrderId)
            .eq("user_id", auth.userId)
            .maybeSingle();
          if (error) throw error;
          if (!order) return Response.json({ error: "PhonePe order not found." }, { status: 404 });
          if (order.status === "failed")
            return Response.json(
              { status: "failed" },
              { headers: { "Cache-Control": "no-store" } },
            );
          if (order.status === "paid")
            return Response.json({ status: "paid" }, { headers: { "Cache-Control": "no-store" } });
          if (!isPhonePeConfigured())
            return Response.json(
              { error: "PhonePe sandbox checkout is not fully configured." },
              { status: 503 },
            );

          const payment = await getPhonePePaymentStatus(merchantOrderId);
          if (payment.state === "COMPLETED") {
            if (payment.amount !== order.amount)
              throw new Error("PhonePe reported an amount that does not match the order.");
            const { error: activationError } = await supabaseAdmin.rpc("activate_phonepe_order", {
              p_merchant_order_id: merchantOrderId,
              p_phonepe_order_id: payment.orderId ?? merchantOrderId,
              p_user_id: auth.userId,
            });
            if (activationError) throw activationError;
            await recordProductEvent(auth.userId, {
              event: "subscription_checkout_confirmed",
              feature: "other",
              dedupeKey: `phonepe:${merchantOrderId}`,
            }).catch(() => undefined);
            return Response.json({ status: "paid" }, { headers: { "Cache-Control": "no-store" } });
          }
          if (payment.state === "FAILED") {
            const { error: updateError } = await supabaseAdmin
              .from("phonepe_orders")
              .update({ status: "failed", phonepe_order_id: payment.orderId ?? null })
              .eq("merchant_order_id", merchantOrderId)
              .eq("user_id", auth.userId)
              .eq("status", "pending");
            if (updateError) throw updateError;
            return Response.json(
              { status: "failed" },
              { headers: { "Cache-Control": "no-store" } },
            );
          }
          return Response.json({ status: "pending" }, { headers: { "Cache-Control": "no-store" } });
        } catch (error) {
          console.error(
            "[billing] PhonePe payment status check failed",
            error instanceof Error ? error.message : "unknown",
          );
          return Response.json({ error: "Could not verify PhonePe payment." }, { status: 503 });
        }
      },
    },
  },
});
