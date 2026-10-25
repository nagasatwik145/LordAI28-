import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/lord/AppShell";
import { authenticatedFetch } from "@/lib/authenticated-fetch";

type Report = {
  rangeDays: number;
  from: string;
  to: string;
  sampleEvents: number;
  sampleActiveDays: number;
  truncated: boolean;
  events: Record<string, number>;
  features: Record<string, number>;
  failures: Record<string, number>;
  reliability: { successes: number; failures: number; sampleRequests: number };
  subscriptions: { sampleEntitlements: number; activeUnexpired: number; inconsistent: number };
};
export const Route = createFileRoute("/_authenticated/admin/analytics")({
  component: AdminAnalytics,
});
function AdminAnalytics() {
  const [days, setDays] = useState(30);
  const report = useQuery({
    queryKey: ["admin-growth-analytics", days],
    queryFn: async () => {
      const response = await authenticatedFetch(`/api/admin/analytics?days=${days}`);
      if (!response.ok)
        throw new Error(
          response.status === 403
            ? "This account is not authorized for analytics administration."
            : "Analytics report unavailable.",
        );
      return response.json() as Promise<Report>;
    },
  });
  const checkoutStarts = report.data?.events.subscription_checkout_initiated ?? 0;
  const checkoutConfirms = report.data?.events.subscription_checkout_confirmed ?? 0;
  return (
    <AppShell>
      <main className="mx-auto max-w-5xl space-y-6 p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Growth operations</h1>
            <p className="text-sm text-muted-foreground">
              Aggregate, opt-in usage and subscription health
            </p>
          </div>
          <select
            className="rounded-md border bg-background px-3 py-2"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
        </header>
        {report.isLoading ? (
          <p>Loading report…</p>
        ) : report.error ? (
          <p role="alert">{report.error.message}</p>
        ) : (
          report.data && (
            <>
              <p className="text-xs text-muted-foreground">
                {new Date(report.data.from).toLocaleDateString()} –{" "}
                {new Date(report.data.to).toLocaleDateString()} · {report.data.sampleEvents} events
                · {report.data.sampleActiveDays} active days
                {report.data.truncated ? " · capped at 5,000 events" : ""}
              </p>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Metric
                  label="Onboarding completion"
                  value={`${report.data.events.onboarding_completed ?? 0} / ${report.data.events.onboarding_started ?? 0}`}
                  detail="event sample"
                />
                <Metric
                  label="Request reliability"
                  value={`${report.data.reliability.successes} / ${report.data.reliability.sampleRequests}`}
                  detail="successful / sampled chat and game requests"
                />
                <Metric
                  label="Subscription health"
                  value={`${report.data.subscriptions.activeUnexpired} active`}
                  detail={`${report.data.subscriptions.sampleEntitlements} entitlement rows sampled; ${report.data.subscriptions.inconsistent} inconsistent`}
                />
                <Metric
                  label="Checkout conversion"
                  value={
                    checkoutStarts
                      ? `${((checkoutConfirms / checkoutStarts) * 100).toFixed(1)}%`
                      : "No sample"
                  }
                  detail={`${checkoutConfirms} confirmations / ${checkoutStarts} initiations`}
                />
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <MetricMap title="Events" rows={report.data.events} />
                <MetricMap title="Feature adoption" rows={report.data.features} />
                <MetricMap title="Failure categories" rows={report.data.failures} />
              </div>
              <p className="text-xs text-muted-foreground">
                These are counts from consenting users only. Event samples are capped; subscription
                totals are bounded to 5,000 rows. Billing amounts and provider cost are not
                inferred.
              </p>
            </>
          )
        )}
      </main>
    </AppShell>
  );
}
function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <section className="rounded-xl border border-border/50 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-2 text-xl font-semibold">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </section>
  );
}
function MetricMap({ title, rows }: { title: string; rows: Record<string, number> }) {
  return (
    <section className="rounded-xl border border-border/50 p-4">
      <h2 className="mb-3 font-medium">{title}</h2>
      {Object.entries(rows).length ? (
        Object.entries(rows)
          .sort((a, b) => b[1] - a[1])
          .map(([key, value]) => (
            <p className="flex justify-between gap-3 py-1 text-sm" key={key}>
              <span>{key.replaceAll("_", " ")}</span>
              <span>{value}</span>
            </p>
          ))
      ) : (
        <p className="text-sm text-muted-foreground">No events in this date range.</p>
      )}
    </section>
  );
}
