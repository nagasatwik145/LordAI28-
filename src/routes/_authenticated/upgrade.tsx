import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Crown, Sparkles, Mic2, Box } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/lord/AppShell";
import { Button } from "@/components/ui/button";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { z } from "zod";

type RazorpayResult = {
  razorpay_payment_id: string;
  razorpay_subscription_id: string;
  razorpay_signature: string;
};
type RazorpayOptions = {
  key: string;
  subscription_id: string;
  name: string;
  description: string;
  handler: (result: RazorpayResult) => void;
  modal: { ondismiss: () => void };
  theme: { color: string };
};
type RazorpayInstance = { open: () => void };
declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

export const Route = createFileRoute("/_authenticated/upgrade")({
  validateSearch: z.object({ phonepeOrder: z.string().optional() }),
  component: UpgradePage,
});

function UpgradePage() {
  const { phonepeOrder } = Route.useSearch();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const queryClient = useQueryClient();
  const { data: status } = useQuery({
    queryKey: ["pro-entitlement"],
    queryFn: async () => {
      const response = await authenticatedFetch("/api/billing/status");
      if (!response.ok) throw new Error("Could not load plan status.");
      return response.json() as Promise<{
        pro: boolean;
        enabled: boolean;
        lifetime: boolean;
        phonepeAvailable: boolean;
        pricing: { monthly: number; yearly: number };
      }>;
    },
  });
  const { data: phonepePayment, error: phonepeStatusError } = useQuery({
    queryKey: ["phonepe-order", phonepeOrder],
    enabled: Boolean(phonepeOrder),
    refetchInterval: (query) =>
      phonepeOrder && query.state.data?.status === "pending" ? 3000 : false,
    queryFn: async () => {
      const response = await authenticatedFetch(
        `/api/billing/phonepe?merchantOrderId=${encodeURIComponent(phonepeOrder!)}`,
      );
      const result = (await response.json()) as { status?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not verify PhonePe payment.");
      return result;
    },
  });

  useEffect(() => {
    if (phonepePayment?.status === "paid") {
      void queryClient.invalidateQueries({ queryKey: ["pro-entitlement"] });
    }
  }, [phonepePayment?.status, queryClient]);

  const loadCheckout = async () => {
    if (window.Razorpay) return;
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Razorpay Checkout could not be loaded."));
      document.body.appendChild(script);
    });
  };
  const subscribe = async (plan: "monthly" | "yearly") => {
    setBusy(plan);
    setError("");
    try {
      const response = await authenticatedFetch("/api/billing/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const result = (await response.json()) as {
        subscriptionId?: string;
        keyId?: string;
        error?: string;
      };
      if (!response.ok || !result.subscriptionId || !result.keyId)
        throw new Error(result.error ?? "Could not start checkout.");
      await loadCheckout();
      if (!window.Razorpay) throw new Error("Razorpay Checkout is unavailable.");
      const checkout = new window.Razorpay({
        key: result.keyId,
        subscription_id: result.subscriptionId,
        name: "LORD AI",
        description: plan === "monthly" ? "LORD Pro Monthly" : "LORD Pro Yearly",
        theme: { color: "#67e8f9" },
        modal: { ondismiss: () => setBusy(null) },
        handler: async (payment) => {
          const verification = await authenticatedFetch("/api/billing/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payment),
          });
          const result = (await verification.json()) as { error?: string };
          if (!verification.ok) {
            setError(result.error ?? "Payment verification failed.");
            setBusy(null);
            return;
          }
          setError(
            "Payment signature verified. Pro access will activate after the verified Razorpay webhook arrives.",
          );
          await queryClient.invalidateQueries({ queryKey: ["pro-entitlement"] });
          setBusy(null);
        },
      });
      checkout.open();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Billing is unavailable.");
      setBusy(null);
    }
  };
  const payWithPhonePe = async (plan: "monthly" | "yearly") => {
    setBusy(`phonepe-${plan}`);
    setError("");
    try {
      const response = await authenticatedFetch("/api/billing/phonepe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const result = (await response.json()) as { checkoutUrl?: string; error?: string };
      if (!response.ok || !result.checkoutUrl)
        throw new Error(result.error ?? "Could not start PhonePe checkout.");
      window.location.assign(result.checkoutUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "PhonePe checkout is unavailable.");
      setBusy(null);
    }
  };
  return (
    <AppShell>
      <main className="mx-auto max-w-5xl py-8 sm:py-14">
        <section className="relative overflow-hidden rounded-3xl border border-cyan-300/20 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 p-6 text-white shadow-2xl shadow-cyan-950/30 sm:p-10">
          <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-cyan-400/15 blur-3xl" />
          <div className="relative grid gap-8 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-200/20 bg-cyan-100/5 px-3 py-1 text-xs uppercase tracking-[0.2em] text-cyan-100">
                <Sparkles className="h-3.5 w-3.5" /> LORD Pro
              </p>
              <h1 className="font-display text-3xl font-semibold sm:text-5xl">
                Upgrade to LORD Pro.
              </h1>
              <p className="mt-4 max-w-xl text-sm leading-6 text-slate-300 sm:text-base">
                Unlock expanded model access, Fast Reply Mode, and LORD Autopilot. Voice
                conversations and 3D game creation remain free for everyone.
              </p>
              {status?.pro && (
                <p className="mt-4 text-sm font-medium text-emerald-300">
                  {status.lifetime
                    ? "Lifetime Pro is active on this account."
                    : "LORD Pro is active on this account."}
                </p>
              )}
            </div>
            <Crown className="hidden h-20 w-20 text-cyan-200 md:block" />
          </div>
        </section>
        {status?.enabled === false && (
          <p className="mt-5 rounded-xl border border-amber-300/20 bg-amber-200/5 p-4 text-sm text-amber-100">
            LORD Pro-exclusive features and new subscriptions are temporarily unavailable. Voice and
            3D game creation remain free.
          </p>
        )}
        {phonepeOrder && (
          <p
            role="status"
            className={`mt-5 rounded-xl border p-4 text-sm ${
              phonepePayment?.status === "paid"
                ? "border-emerald-300/20 bg-emerald-200/5 text-emerald-100"
                : phonepePayment?.status === "failed"
                  ? "border-rose-300/20 bg-rose-200/5 text-rose-100"
                  : "border-cyan-300/20 bg-cyan-200/5 text-cyan-100"
            }`}
          >
            {phonepePayment?.status === "paid"
              ? "PhonePe payment confirmed. LORD Pro is active."
              : phonepePayment?.status === "failed"
                ? "PhonePe could not complete the payment. You can try checkout again."
                : "Checking PhonePe payment status…"}
          </p>
        )}
        {phonepeOrder && phonepeStatusError instanceof Error && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {phonepeStatusError.message}
          </p>
        )}
        <section className="mt-8 grid gap-4 sm:grid-cols-3">
          <article className="rounded-2xl border border-border bg-card/70 p-6">
            <p className="text-sm text-muted-foreground">Free</p>
            <p className="mt-2 text-3xl font-semibold">₹0</p>
            <p className="mt-2 text-sm text-muted-foreground">Core LORD AI features</p>
            <ul className="mt-6 space-y-3 text-sm">
              <Feature>Chat and everyday tools</Feature>
              <Feature>2D and 3D game creation</Feature>
              <Feature>Voice interactions</Feature>
              <Feature>Personal workspace</Feature>
            </ul>
          </article>
          <PlanCard
            title="LORD Pro Monthly"
            price={`₹${status?.pricing.monthly ?? 99}`}
            suffix="/month"
            onChoose={() => void subscribe("monthly")}
            busy={busy === "monthly"}
            checkingOut={Boolean(busy)}
            disabled={status?.enabled !== true || Boolean(status.pro)}
            unavailable={status?.enabled === false}
            onPhonePe={() => void payWithPhonePe("monthly")}
            phonePeBusy={busy === "phonepe-monthly"}
            phonePeUnavailable={!status?.phonepeAvailable}
          />
          <PlanCard
            title="LORD Pro Yearly"
            price={`₹${status?.pricing.yearly ?? 990}`}
            suffix="/year"
            featured
            onChoose={() => void subscribe("yearly")}
            busy={busy === "yearly"}
            checkingOut={Boolean(busy)}
            disabled={status?.enabled !== true || Boolean(status.pro)}
            unavailable={status?.enabled === false}
            onPhonePe={() => void payWithPhonePe("yearly")}
            phonePeBusy={busy === "phonepe-yearly"}
            phonePeUnavailable={!status?.phonepeAvailable}
          />
        </section>
        <section className="mt-7 rounded-2xl border border-border bg-card/50 p-5 sm:p-7">
          <h2 className="text-lg font-semibold">Available to everyone</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="flex gap-3">
              <Mic2 className="h-5 w-5 shrink-0 text-cyan-300" />
              <div>
                <p className="font-medium">Voice interactions</p>
                <p className="text-sm text-muted-foreground">
                  Hands-free conversations and spoken responses.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <Box className="h-5 w-5 shrink-0 text-violet-300" />
              <div>
                <p className="font-medium">3D game creation</p>
                <p className="text-sm text-muted-foreground">
                  Generate, save, and play immersive 3D games.
                </p>
              </div>
            </div>
          </div>
        </section>
        {error && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {error}
          </p>
        )}
        <p className="mt-5 text-center text-xs text-muted-foreground">
          Razorpay subscriptions support UPI apps such as Google Pay when enabled for your merchant
          account. PhonePe checkout is a one-time payment and grants the selected plan period.
        </p>
      </main>
    </AppShell>
  );
}

function Feature({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <Check className="h-4 w-4 text-emerald-400" />
      {children}
    </li>
  );
}
function PlanCard({
  title,
  price,
  suffix,
  featured,
  busy,
  checkingOut,
  disabled,
  unavailable,
  onChoose,
  onPhonePe,
  phonePeBusy,
  phonePeUnavailable,
}: {
  title: string;
  price: string;
  suffix: string;
  featured?: boolean;
  busy: boolean;
  checkingOut: boolean;
  disabled: boolean;
  unavailable: boolean;
  onChoose: () => void;
  onPhonePe: () => void;
  phonePeBusy: boolean;
  phonePeUnavailable: boolean;
}) {
  return (
    <article
      className={`relative rounded-2xl border p-6 ${featured ? "border-cyan-300/50 bg-gradient-to-b from-cyan-300/10 to-card shadow-lg shadow-cyan-950/20" : "border-border bg-card/70"}`}
    >
      {featured && (
        <span className="absolute right-4 top-4 rounded-full bg-cyan-200 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-950">
          Best value
        </span>
      )}
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="mt-2 text-3xl font-semibold">
        {price}
        <span className="text-sm font-normal text-muted-foreground">{suffix}</span>
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        Get more from LORD AI with expanded access to powerful features.
      </p>
      <ul className="my-6 space-y-3 text-sm">
        <Feature>Expanded model access</Feature>
        <Feature>Fast Reply Mode</Feature>
        <Feature>LORD Autopilot</Feature>
      </ul>
      <Button
        className="w-full"
        variant={featured ? "default" : "outline"}
        onClick={onChoose}
        disabled={disabled || checkingOut}
      >
        {busy
          ? "Opening checkout…"
          : unavailable
            ? "Temporarily unavailable"
            : disabled
              ? "Pro is active"
              : "Subscribe with Razorpay"}
      </Button>
      <Button
        className="mt-2 w-full"
        variant="ghost"
        onClick={onPhonePe}
        disabled={disabled || checkingOut || phonePeUnavailable}
      >
        {phonePeBusy
          ? "Opening PhonePe…"
          : phonePeUnavailable
            ? "PhonePe unavailable"
            : "Pay once with PhonePe"}
      </Button>
    </article>
  );
}
