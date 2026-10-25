import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Capacitor } from "@capacitor/core";
import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  Clock3,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { HealthCenterSnapshot, HealthCheck, HealthStatus } from "@/lib/health-center.types";

export const Route = createFileRoute("/_authenticated/observability/")({
  component: ObservabilityPage,
});

function ObservabilityPage() {
  const [health, setHealth] = useState<HealthCenterSnapshot>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const requestController = useRef<AbortController | null>(null);

  const refresh = useCallback(async (activeChecks = false) => {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setLoading(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/health-center${activeChecks ? "?active=1" : ""}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error("Your session has expired. Sign in again to view diagnostics.");
        }
        if (response.status === 429) {
          throw new Error(
            "Diagnostics are limited to eight checks per minute. Wait before retrying.",
          );
        }
        throw new Error("The health center could not be reached. Try again shortly.");
      }
      const result = (await response.json()) as HealthCenterSnapshot;
      if (!controller.signal.aborted) setHealth(addClientCapabilityChecks(result));
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "Diagnostics could not be loaded.");
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
      if (requestController.current === controller) requestController.current = null;
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => requestController.current?.abort();
  }, [refresh]);

  const checks = health?.checks ?? [];
  return (
    <main className="min-h-full space-y-6 bg-[#080d18] p-4 text-slate-100 sm:p-6 lg:p-8">
      <header className="flex flex-col justify-between gap-4 border-b border-cyan-400/15 pb-5 sm:flex-row sm:items-center">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300">
            LORD AI · SYSTEM DIAGNOSTICS
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Health Center
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">
            Safe, authenticated checks for core services and optional integrations. No content is
            generated and no file, payment, or search operation is performed.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => void refresh()}
            disabled={loading}
            className="border-cyan-300/30 bg-slate-900 text-slate-100 hover:bg-cyan-950"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            onClick={() => void refresh(true)}
            disabled={loading}
            className="bg-cyan-400 text-slate-950 hover:bg-cyan-300"
          >
            <ShieldCheck className="mr-2 h-4 w-4" />
            Run safe provider checks
          </Button>
        </div>
      </header>

      <section aria-live="polite" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="border-cyan-400/20 bg-slate-900/80 p-5 sm:col-span-2">
          <p className="text-sm text-slate-400">Core service status</p>
          <div className="mt-2 flex items-center gap-3">
            <StatusIcon status={health?.status ?? "Not Tested"} />
            <span className="text-2xl font-semibold text-white">
              {loading && !health ? "Checking…" : (health?.status ?? "Not Tested")}
            </span>
          </div>
          <p className="mt-3 text-sm text-slate-400">
            {health
              ? "Optional integrations marked Not Tested or Not Configured are not counted as core failures."
              : "Waiting for an authenticated diagnostics response."}
          </p>
        </Card>
        <Card className="border-cyan-400/20 bg-slate-900/80 p-5">
          <p className="text-sm text-slate-400">Last checked</p>
          <p className="mt-3 flex items-center gap-2 text-sm font-medium text-white">
            <Clock3 className="h-4 w-4 text-cyan-300" />
            {health ? new Date(health.checkedAt).toLocaleString() : "—"}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            {health?.activeChecks
              ? "Safe provider catalog checks were requested."
              : "Lightweight checks only."}
          </p>
        </Card>
        <Card className="border-cyan-400/20 bg-slate-900/80 p-5">
          <p className="text-sm text-slate-400">Integration checks</p>
          <p className="mt-3 text-2xl font-semibold text-white">
            {checks.filter((check) => check.status === "Healthy").length}
            <span className="text-base font-normal text-slate-500"> / {checks.length}</span>
          </p>
          <p className="mt-2 text-xs text-slate-500">Verified during this request</p>
        </Card>
      </section>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-400/30 bg-rose-950/30 p-4 text-sm text-rose-200"
        >
          {error}
        </div>
      )}

      <section
        aria-label="Service diagnostics"
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
      >
        {checks.map((check) => (
          <HealthCheckCard key={check.id} check={check} />
        ))}
        {loading && !health && (
          <Card className="border-cyan-400/20 bg-slate-900/80 p-5 text-sm text-slate-400">
            Loading service diagnostics…
          </Card>
        )}
      </section>

      <p className="text-xs leading-relaxed text-slate-500">
        Active checks only read provider model catalogs using short timeouts. They do not invoke a
        model. Provider credentials and upstream response details are never returned to the client.
      </p>
    </main>
  );
}

function HealthCheckCard({ check }: { check: HealthCheck }) {
  return (
    <Card className="border-cyan-400/15 bg-slate-900/70 p-4 transition-colors hover:border-cyan-300/35">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-medium text-white">{check.label}</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">{check.summary}</p>
        </div>
        <StatusIcon status={check.status} />
      </div>
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-white/5 pt-3">
        <StatusPill status={check.status} />
        <span className="text-[11px] uppercase tracking-wide text-slate-500">
          {verificationLabel(check.verification)}
        </span>
      </div>
    </Card>
  );
}

function StatusIcon({ status }: { status: HealthStatus }) {
  if (status === "Healthy")
    return <CheckCircle2 aria-hidden="true" className="h-5 w-5 text-emerald-400" />;
  if (status === "Unavailable" || status === "Degraded") {
    return <AlertTriangle aria-hidden="true" className="h-5 w-5 text-amber-300" />;
  }
  return <CircleHelp aria-hidden="true" className="h-5 w-5 text-cyan-300" />;
}

function StatusPill({ status }: { status: HealthStatus }) {
  const styles: Record<HealthStatus, string> = {
    Healthy: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
    Degraded: "border-amber-400/25 bg-amber-400/10 text-amber-200",
    Unavailable: "border-rose-400/25 bg-rose-400/10 text-rose-200",
    "Not Configured": "border-slate-400/20 bg-slate-400/5 text-slate-400",
    "Not Tested": "border-cyan-300/20 bg-cyan-300/5 text-cyan-200",
  };
  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}

function verificationLabel(verification: HealthCheck["verification"]): string {
  if (verification === "request") return "Request verified";
  if (verification === "connectivity") return "Connectivity verified";
  if (verification === "configuration") return "Configuration";
  return "Not tested";
}

function addClientCapabilityChecks(snapshot: HealthCenterSnapshot): HealthCenterSnapshot {
  if (typeof window === "undefined") return snapshot;

  const android = Capacitor.getPlatform() === "android";
  const isNative = Capacitor.isNativePlatform();
  const hasSpeechRecognition = "SpeechRecognition" in window || "webkitSpeechRecognition" in window;
  const hasSpeechOutput = "speechSynthesis" in window;
  const hasNotificationApi = "Notification" in window;
  const localNotificationsAvailable = Capacitor.isPluginAvailable("LocalNotifications");
  const checks = snapshot.checks.map((check) => {
    if (check.id === "voice-speech") {
      return {
        ...check,
        status: hasSpeechRecognition || hasSpeechOutput ? "Not Tested" : "Unavailable",
        summary:
          hasSpeechRecognition || hasSpeechOutput
            ? `Speech ${[hasSpeechRecognition && "recognition", hasSpeechOutput && "synthesis"].filter(Boolean).join(" and ")} capability detected; no microphone permission or speech operation was requested.`
            : "This browser does not expose speech recognition or speech synthesis.",
      } satisfies HealthCheck;
    }
    if (check.id === "notifications") {
      return {
        ...check,
        status: hasNotificationApi || localNotificationsAvailable ? "Not Tested" : "Unavailable",
        summary:
          hasNotificationApi || localNotificationsAvailable
            ? `Notification capability detected${localNotificationsAvailable ? " (native local notifications available)" : ""}; permission was not requested.`
            : "This runtime does not expose browser or native local notifications.",
      } satisfies HealthCheck;
    }
    if (check.id === "capacitor-android") {
      return {
        ...check,
        status: "Not Tested",
        summary: android
          ? "The app is running in the Capacitor Android runtime; device-specific operations were not run."
          : isNative
            ? `Capacitor ${Capacitor.getPlatform()} runtime detected; Android-specific checks do not apply.`
            : "Browser runtime detected; Android device capabilities cannot be confirmed here.",
      } satisfies HealthCheck;
    }
    return check;
  });
  const status =
    snapshot.status === "Healthy" && checks.some((check) => check.status === "Unavailable")
      ? "Degraded"
      : snapshot.status;
  return { ...snapshot, status, checks };
}
