import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  ArrowUp,
  Calendar,
  Brain,
  GraduationCap,
  LoaderCircle,
  MessageSquare,
  Mic2,
  Target,
  Wifi,
  WifiOff,
} from "lucide-react";
import { AppShell } from "@/components/lord/AppShell";
import { HudPanel } from "@/components/lord/HudPanel";
import { MotionReveal } from "@/components/lord/MotionReveal";
import { useDashboard } from "@/hooks/use-dashboard";
import { useCurrentUser } from "@/hooks/use-current-user";
import { supabase } from "@/integrations/supabase/client";
import { Route as AuthRoute } from "./auth";
import { LastSynced } from "@/components/lord/dashboard/shared";
import {
  LORDStatusPanel,
  AIStatusWidget,
  TasksWidget,
  CalendarWidget,
  MemoryWidget,
  ConversationsWidget,
  NotificationCenter,
} from "@/components/lord/dashboard/panels";

const EnergyOrb = lazy(() =>
  import("@/components/lord/EnergyOrb").then((module) => ({ default: module.EnergyOrb })),
);

export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user) return;

    const guestResponse = await fetch("/api/guest/session", {
      credentials: "same-origin",
      cache: "no-store",
    }).catch(() => null);
    if (!guestResponse?.ok) return;

    const guest = (await guestResponse.json().catch(() => null)) as {
      guest?: boolean;
      active?: boolean;
    } | null;
    if (guest?.guest && guest.active) {
      throw redirect({ to: "/chat", replace: true });
    }
  },
  head: () => ({
    meta: [
      { title: "LORD AI — Your Intelligence. Your Command." },
      {
        name: "description",
        content:
          "Meet your personal AI command center. Sign in to LORD AI or explore free for 10 minutes.",
      },
      { property: "og:title", content: "LORD AI" },
      { property: "og:description", content: "Intelligence Beyond Assistance." },
    ],
  }),
  component: HomeRoute,
});

function HomeRoute() {
  const { user, loading } = useCurrentUser();
  if (loading) return <div className="min-h-screen bg-[#030307]" aria-busy="true" />;
  const AuthLandingPage = AuthRoute.options.component;
  return user ? <Command /> : AuthLandingPage ? <AuthLandingPage /> : null;
}

const QUICK_ACTIONS = [
  { to: "/chat", label: "Chat", icon: MessageSquare, hint: "Talk to LORD" },
  { to: "/voice", label: "Voice Assistant", icon: Mic2, hint: "Say Hey, LORD" },
  { to: "/study", label: "Study", icon: GraduationCap, hint: "Learn faster" },
  { to: "/calendar", label: "Calendar", icon: Calendar, hint: "Your timeline" },
  { to: "/productivity", label: "Tasks", icon: Target, hint: "Get it done" },
  { to: "/memory", label: "Memory", icon: Brain, hint: "Recall" },
] as const;

function Command() {
  const d = useDashboard();
  const { user } = useCurrentUser();
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState("");
  const [now, setNow] = useState<Date | null>(null);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    const updateTime = () => setNow(new Date());
    updateTime();
    const interval = window.setInterval(updateTime, 60_000);
    return () => window.clearInterval(interval);
  }, []);
  const accountName =
    (user?.user_metadata?.name as string | undefined)?.trim() || user?.email?.split("@")[0] || "";
  const greetingName = accountName.split(/\s+/)[0];
  const hour = now?.getHours() ?? -1;
  const timeGreeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const todayLabel = now
    ? new Intl.DateTimeFormat(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      }).format(now)
    : "Your day, at a glance";
  const backendMessage = d.systemState.isLoading
    ? "Checking backend"
    : d.systemState.isError
      ? "Backend check failed"
      : d.system.engine === "online"
        ? "Backend reachable"
        : "Backend unavailable";
  const providerMessage = d.aiState.isLoading
    ? "Checking AI provider"
    : {
        available: "OpenRouter available",
        missing_credentials: "OpenRouter not configured",
        invalid_credentials: "OpenRouter credentials rejected",
        rate_limited: "OpenRouter rate limited",
        timeout: "OpenRouter check timed out",
        unavailable: "OpenRouter unavailable",
      }[d.ai.providerStatus];

  const openChat = (initialText?: string) => {
    void navigate({ to: "/chat" }).then(() => {
      window.setTimeout(() => {
        if (initialText?.trim()) {
          window.dispatchEvent(
            new CustomEvent("lord:chat-prefill", { detail: { text: initialText.trim() } }),
          );
        } else {
          window.dispatchEvent(new Event("lord:chat-focus"));
        }
      }, 50);
    });
  };

  const submitPrompt = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!prompt.trim()) return;
    openChat(prompt);
  };

  return (
    <AppShell>
      <section className="hero-core-panel relative mb-8 overflow-hidden rounded-2xl hud-panel p-5 sm:p-8 md:p-12">
        <div
          className="absolute inset-0 -z-0 opacity-30"
          style={{ background: "var(--gradient-radial)" }}
        />
        <div className="relative z-10 grid items-center gap-1 md:grid-cols-[minmax(0,1fr)_auto] md:gap-4">
          <motion.div
            className="min-w-0 order-2 md:order-1"
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.55, ease: [0.22, 1, 0.36, 1] }}
          >
            <p className="flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground sm:text-xs">
              <span className="inline-flex items-center gap-2" aria-live="polite">
                {d.systemState.isLoading ? (
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : d.system.engine === "online" ? (
                  <Wifi className="h-3.5 w-3.5 text-[var(--hud-success)]" aria-hidden="true" />
                ) : (
                  <WifiOff className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
                )}
                {backendMessage}
              </span>
              <span className="inline-flex items-center gap-2" aria-live="polite">
                {d.ai.providerStatus === "available" ? (
                  <Activity className="h-3.5 w-3.5 text-[var(--hud-success)]" aria-hidden="true" />
                ) : d.ai.providerStatus === "rate_limited" || d.ai.providerStatus === "timeout" ? (
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-300" aria-hidden="true" />
                ) : (
                  <WifiOff className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
                )}
                {providerMessage}
              </span>
              <span aria-hidden="true" className="hidden text-border sm:inline">
                /
              </span>
              <span>{todayLabel}</span>
            </p>
            <h1 className="mt-4 max-w-3xl font-display text-4xl font-semibold leading-[1.08] tracking-[-0.035em] sm:text-5xl md:text-[4.4rem]">
              {now && greetingName
                ? `${timeGreeting}, ${greetingName}.`
                : now
                  ? `${timeGreeting}.`
                  : "Welcome."}
            </h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-muted-foreground md:text-lg md:leading-8">
              Your AI command center is ready. What would you like to work on?
            </p>
            <form
              onSubmit={submitPrompt}
              className="mt-6 max-w-2xl rounded-2xl border border-primary/25 bg-background/65 p-2 shadow-[0_12px_36px_rgba(0,0,0,0.2)] backdrop-blur-xl focus-within:border-primary/60 focus-within:ring-1 focus-within:ring-primary/25"
            >
              <label htmlFor="home-chat-prompt" className="sr-only">
                Message LORD AI
              </label>
              <textarea
                id="home-chat-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                rows={2}
                placeholder="Ask LORD anything…"
                className="min-h-12 w-full resize-y bg-transparent px-3 py-2 text-base text-foreground outline-none placeholder:text-muted-foreground"
              />
              <div className="flex items-center justify-between gap-3 px-2 pb-1">
                <span className="text-[11px] text-muted-foreground">
                  Enter to continue · Shift+Enter for a new line
                </span>
                <button
                  type="submit"
                  disabled={!prompt.trim()}
                  className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Send <ArrowUp className="h-4 w-4" />
                </button>
              </div>
            </form>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => openChat()}
                className="hero-secondary-button inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-medium text-foreground/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Open chat
              </button>
              <a
                href="#workspace-modules"
                className="inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Explore tools
              </a>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <LastSynced at={d.lastSynced} />
            </div>
          </motion.div>
          <motion.div
            className="lord-orb-stage relative order-1 mx-auto -my-3 block md:order-2 md:my-0 md:-mr-2"
            initial={reduceMotion ? false : { opacity: 0, scale: 0.94, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{
              duration: reduceMotion ? 0 : 0.8,
              delay: reduceMotion ? 0 : 0.12,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <Suspense
              fallback={
                <div
                  className="h-56 w-56 sm:h-72 sm:w-72 md:h-[390px] md:w-[390px]"
                  aria-hidden="true"
                />
              }
            >
              <EnergyOrb />
            </Suspense>
          </motion.div>
        </div>
      </section>

      <div
        id="workspace-modules"
        className="mb-8 grid scroll-mt-24 grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-6"
      >
        {QUICK_ACTIONS.map(({ to, label, icon: Icon, hint }, i) => (
          <motion.div
            key={to}
            initial={reduceMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: reduceMotion ? 0 : 0.32,
              delay: reduceMotion ? 0 : i * 0.05,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <Link
              to={to}
              className="quick-action-card group flex h-full min-h-28 flex-col items-start gap-3 rounded-xl border border-border/70 p-4 sm:p-5"
            >
              {Icon && (
                <span className="quick-action-icon grid h-10 w-10 place-items-center rounded-xl border border-primary/15 bg-primary/[0.07]">
                  <Icon className="h-5 w-5 text-primary transition group-hover:scale-110" />
                </span>
              )}
              <div className="w-full">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-display text-sm font-medium tracking-wide">{label}</div>
                  <span className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-muted-foreground/70">
                    <span className="h-1 w-1 rounded-full bg-cyan-300/80" aria-hidden="true" />
                    Open
                  </span>
                </div>
                <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{hint}</div>
              </div>
            </Link>
          </motion.div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <MotionReveal>
          <TasksWidget data={d.tasks} state={d.tasksState} />
        </MotionReveal>
        <MotionReveal delay={0.04}>
          <CalendarWidget data={d.calendar} state={d.calendarState} />
        </MotionReveal>
        <MotionReveal delay={0.08}>
          <ConversationsWidget data={d.conversations} state={d.conversationsState} />
        </MotionReveal>
        <MotionReveal delay={0.12}>
          <NotificationCenter data={d.notifications} state={d.notificationsState} />
        </MotionReveal>
        <MotionReveal delay={0.16}>
          <MemoryWidget data={d.memory} state={d.memoryState} />
        </MotionReveal>
        <MotionReveal delay={0.24}>
          <LORDStatusPanel
            system={d.system}
            ai={d.ai}
            state={d.systemState}
            lastSynced={d.lastSynced}
          />
        </MotionReveal>
        <MotionReveal delay={0.28}>
          <AIStatusWidget data={d.ai} state={d.aiState} />
        </MotionReveal>
        <MotionReveal delay={0.32}>
          <HudPanel title="Directive" subtitle={`Mode: ${d.ai.activeMode}`}>
            <p className="text-sm text-muted-foreground">
              "<span className="text-foreground italic">Intelligence Beyond Assistance.</span>"
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              Tip: use <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px]">⌘K</kbd> in Chat
              to switch reasoning modes.
            </p>
          </HudPanel>
        </MotionReveal>
      </div>
    </AppShell>
  );
}
