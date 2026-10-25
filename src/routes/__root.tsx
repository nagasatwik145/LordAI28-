import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode, useRef, useState } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { WakeWordProvider } from "../components/lord/WakeWordProvider";
import { AppContextProvider } from "../components/lord/AppContextProvider";
import { CalendarProvider } from "../components/lord/CalendarProvider";
import { setupApiInterceptor } from "../lib/api-interceptor";
import { getUserSettings } from "../lib/user-settings.functions";
import { useQuery } from "@tanstack/react-query";
import { DEFAULT_MODE, type LordMode } from "../lib/modes";
import { supabase } from "../integrations/supabase/client";
import { X } from "lucide-react";
import { GlobalFooter } from "../components/lord/GlobalFooter";
import {
  decideConnectivity,
  probeBackendReachability,
  type ConnectivityDecision,
} from "../lib/connectivity";

function UserSettingsHydrator({ children }: { children: ReactNode }) {
  const { data: userSettings } = useQuery({
    queryKey: ["user_settings"],
    queryFn: getUserSettings,
  });

  const voiceMode: LordMode = (userSettings?.default_mode as LordMode) ?? DEFAULT_MODE;
  const autoSpeak = userSettings?.auto_speak ?? true;
  const voiceRate = userSettings?.voice_rate ?? 1;

  return (
    <WakeWordProvider mode={voiceMode} autoSpeak={autoSpeak} voiceRate={voiceRate}>
      {children}
    </WakeWordProvider>
  );
}

function registerServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !import.meta.env.PROD) {
    return;
  }
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}

registerServiceWorker();

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  const displayError = error instanceof Error ? error : new Error(String(error));
  const rawMessage = displayError.message;
  const missingApiBase = rawMessage.includes("VITE_API_BASE_URL");
  const networkFailure = /network|fetch|load failed|cors/i.test(rawMessage);
  const userMessage = missingApiBase
    ? "This Android build is missing its secure server address. Reinstall an updated app build."
    : networkFailure
      ? "LORD AI could not connect to its server. Check your connection and try again."
      : "LORD AI hit an unexpected startup error. Try again, or contact support with the diagnostic code below.";
  const diagnosticCode = `STARTUP-${
    displayError.name
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 12) || "ERROR"
  }`;
  console.error("[startup] root error boundary", {
    diagnosticCode,
    errorName: displayError.name.slice(0, 80),
    failureType: missingApiBase ? "api_base_missing" : networkFailure ? "network" : "unexpected",
  });
  const router = useRouter();
  useEffect(() => {
    reportLovableError(new Error(diagnosticCode), {
      boundary: "tanstack_root_error_component",
    });
  }, [diagnosticCode]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{userMessage}</p>
        <p className="mt-2 text-xs text-muted-foreground" role="note">
          Diagnostic code: {diagnosticCode}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "theme-color", content: "#0a0e1a" },
      { title: "LORD AI — Personal Intelligence" },
      {
        name: "description",
        content: "LORD — the autonomous AI.",
      },
      { property: "og:title", content: "LORD AI — Personal Intelligence" },
      {
        property: "og:description",
        content:
          "NSK145 analyzes and resolves all end-to-end errors in a GitHub repository, ensuring full application functionality.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "LORD AI — Personal Intelligence" },
      {
        name: "description",
        content:
          "NSK145 analyzes and resolves all end-to-end errors in a GitHub repository, ensuring full application functionality.",
      },
      {
        name: "twitter:description",
        content:
          "NSK145 analyzes and resolves all end-to-end errors in a GitHub repository, ensuring full application functionality.",
      },
      {
        property: "og:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/2f40c7c4-5be3-4e13-8e54-13b7f6fed270/id-preview-43e60b92--5ed0f069-9f8e-4bd0-ab56-d3a9923cde2b.lovable.app-1781964593862.png",
      },
      {
        name: "twitter:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/2f40c7c4-5be3-4e13-8e54-13b7f6fed270/id-preview-43e60b92--5ed0f069-9f8e-4bd0-ab56-d3a9923cde2b.lovable.app-1781964593862.png",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/lord-icon.png" },
      { rel: "icon", href: "/lord-icon.png", type: "image/png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <GlobalFooter />
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    setupApiInterceptor();
    void import("../lib/mobile-native").then(({ initializeMobileRuntime }) =>
      initializeMobileRuntime(),
    );
    let disposed = false;
    let removeListeners: () => void = () => {};
    let removeOAuthListener: () => void = () => {};
    void import("../lib/native-oauth")
      .then(({ registerNativeOAuthCallbacks }) =>
        registerNativeOAuthCallbacks(() => {
          void router.navigate({ to: "/chat", replace: true });
        }),
      )
      .then((remove) => {
        if (disposed) remove();
        else removeOAuthListener = remove;
      });
    void import("../lib/mobile-native")
      .then(({ registerMobileNavigation }) =>
        registerMobileNavigation(
          (route) => {
            void router.navigate({ to: route as never });
          },
          (active) => {
            if (active) {
              void supabase.auth.startAutoRefresh();
              void supabase.auth.getSession().catch(() => undefined);
            } else {
              supabase.auth.stopAutoRefresh();
            }
          },
        ),
      )
      .then((remove) => {
        if (disposed) remove();
        else removeListeners = remove;
      });
    return () => {
      disposed = true;
      removeListeners();
      removeOAuthListener();
    };
  }, [router]);

  return (
    <QueryClientProvider client={queryClient}>
      <AppContextProvider>
        <CalendarProvider>
          <UserSettingsHydrator>
            <ConnectivityNotice />
            {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
            <Outlet />
          </UserSettingsHydrator>
        </CalendarProvider>
      </AppContextProvider>
    </QueryClientProvider>
  );
}

function ConnectivityNotice() {
  const [connectivity, setConnectivity] = useState<ConnectivityDecision>("unknown");
  const connectivityRef = useRef<ConnectivityDecision>("unknown");
  const [expanded, setExpanded] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let disposed = false;
    let nativeOnline: boolean | null = null;
    let offlineFailures = 0;
    let probeSequence = 0;
    let verificationTimer: number | undefined;
    let retryTimer: number | undefined;
    let removeNativeListener: () => void = () => {};

    const report = (
      reason: string,
      source: string,
      backendReachable: boolean | null,
      result: ConnectivityDecision,
    ) => {
      if (import.meta.env.DEV) {
        console.debug("[connectivity]", {
          navigatorOnLine: navigator.onLine,
          connectivitySource: source,
          backendReachability: backendReachable,
          nativeOnline,
          result,
          reason,
        });
      }
    };

    const apply = (
      next: ConnectivityDecision,
      reason: string,
      source: string,
      backendReachable: boolean | null,
    ) => {
      report(reason, source, backendReachable, next);
      if (next === "unknown" || connectivityRef.current === next) return;
      connectivityRef.current = next;
      setConnectivity(next);
      if (next === "offline") {
        setDismissed(false);
        setExpanded(true);
      }
    };

    const clearVerificationTimers = () => {
      if (verificationTimer !== undefined) window.clearTimeout(verificationTimer);
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      verificationTimer = undefined;
      retryTimer = undefined;
    };

    const verify = async (reason: string) => {
      if (disposed) return;
      const probeId = ++probeSequence;
      const reachable = await probeBackendReachability();
      if (disposed || probeId !== probeSequence) return;

      if (reachable === null && !navigator.onLine) {
        offlineFailures = 0;
        apply("unknown", `${reason}; backend probe unavailable`, "backend-unconfigured", null);
        retryTimer = window.setTimeout(() => void verify("connectivity retry"), 8_000);
        return;
      }

      if (navigator.onLine || reachable === true) {
        offlineFailures = 0;
        const decision = decideConnectivity({
          navigatorOnline: navigator.onLine,
          backendReachable: reachable,
          nativeOnline,
          consecutiveFailures: offlineFailures,
        });
        apply(decision, reason, reachable === true ? "backend" : "navigator", reachable);
        return;
      }

      offlineFailures += 1;
      const decision = decideConnectivity({
        navigatorOnline: navigator.onLine,
        backendReachable: false,
        nativeOnline,
        consecutiveFailures: offlineFailures,
      });
      apply(decision, `${reason}; failed probe ${offlineFailures}/2`, "navigator+backend", false);

      if (decision !== "offline") {
        verificationTimer = window.setTimeout(() => void verify("offline confirmation"), 700);
      } else {
        retryTimer = window.setTimeout(() => void verify("offline retry"), 8_000);
      }
    };

    const scheduleVerification = (reason: string) => {
      probeSequence += 1;
      if (navigator.onLine) {
        clearVerificationTimers();
        offlineFailures = 0;
        apply("online", reason, "navigator", null);
        void verify(`${reason}; backend diagnostic`);
        return;
      }
      if (verificationTimer !== undefined) window.clearTimeout(verificationTimer);
      verificationTimer = window.setTimeout(() => void verify(reason), 350);
    };

    const onOnline = () => {
      clearVerificationTimers();
      offlineFailures = 0;
      apply("online", "browser online event", "navigator", null);
      void verify("browser online event; backend diagnostic");
    };
    const onOffline = () => scheduleVerification("browser offline event");
    const onVisibility = () => {
      if (document.visibilityState === "visible") scheduleVerification("page became visible");
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisibility);
    if (navigator.onLine) {
      apply("online", "startup browser signal", "navigator", null);
      void verify("startup backend diagnostic");
    } else {
      scheduleVerification("startup browser signal is offline");
    }

    void import("../lib/mobile-native").then(async ({ isNativeMobile, mobileNetwork }) => {
      if (disposed || !isNativeMobile()) return;
      const status = await mobileNetwork.status().catch(() => null);
      if (status) {
        nativeOnline = status.connected;
        report("native startup signal", "capacitor", null, connectivityRef.current);
        if (!navigator.onLine && !status.connected)
          scheduleVerification("native startup signal is offline");
      }
      const handle = await mobileNetwork.listen(({ connected }) => {
        nativeOnline = connected;
        report("native network status changed", "capacitor", null, connectivityRef.current);
        if (navigator.onLine) return;
        if (!connected) scheduleVerification("native network reports offline");
        else void verify("native network restored; verify backend");
      });
      if (disposed) void handle.remove();
      else removeNativeListener = () => void handle.remove();
    });
    return () => {
      disposed = true;
      clearVerificationTimers();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisibility);
      removeNativeListener();
    };
  }, []);

  useEffect(() => {
    if (connectivity !== "offline" || !expanded) return;
    const timer = window.setTimeout(() => setExpanded(false), 5000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [connectivity, expanded]);

  if (connectivity !== "offline" || dismissed) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed top-3 z-[100] mx-auto transition-all duration-300 ${expanded ? "inset-x-3 max-w-xl" : "right-3"}`}
    >
      {expanded ? (
        <div className="offline-notice relative rounded-2xl border px-10 py-3 text-center text-sm leading-6 text-amber-100">
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss offline notice"
            className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-lg text-amber-100/65 transition-colors hover:bg-white/10 hover:text-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            <X className="h-4 w-4" />
          </button>
          You’re offline. Saved study data stays available; new messages and uploads need a
          connection.
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-label="Offline. Show connection details."
          aria-expanded={false}
          title="Show connection details"
          className="offline-notice inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium text-amber-100 transition-colors duration-200 hover:border-amber-300/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-amber-300" aria-hidden="true" />
          Offline
        </button>
      )}
    </div>
  );
}
