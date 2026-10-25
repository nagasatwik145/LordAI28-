import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { getOAuthRedirect } from "@/lib/native-oauth";
import { AppShell } from "@/components/lord/AppShell";
import { HudPanel } from "@/components/lord/HudPanel";
import { Loader2, Mail, Lock, User as UserIcon, Chrome } from "lucide-react";

type Mode = "signin" | "signup" | "forgot";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({ meta: [{ title: "LORD — Sign In" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const hasNavigatedAfterAuth = useRef(false);

  const navigateAfterAuth = useCallback(() => {
    if (hasNavigatedAfterAuth.current) return;
    hasNavigatedAfterAuth.current = true;
    navigate({ to: "/chat", replace: true });
  }, [navigate]);

  useEffect(() => {
    let mounted = true;
    const authListener = Capacitor.isNativePlatform()
      ? null
      : supabase.auth.onAuthStateChange((event, session) => {
          if (mounted && (event === "SIGNED_IN" || event === "INITIAL_SESSION") && session?.user) {
            navigateAfterAuth();
          }
        });

    const initializeAuth = async () => {
      if (typeof window === "undefined") return;

      const { data } = await supabase.auth.getSession();
      if (mounted && data.session?.user) {
        navigateAfterAuth();
      }
    };

    initializeAuth();

    return () => {
      mounted = false;
      authListener?.data.subscription.unsubscribe();
    };
  }, [navigateAfterAuth]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/chat`,
            data: { name: name.trim() || email.split("@")[0] },
          },
        });
        if (error) throw error;
        setInfo("Account created. Check your inbox to confirm, then sign in.");
        setMode("signin");
      } else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        setInfo("Password reset email sent. Check your inbox.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/chat" });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  const signInWithGoogle = async () => {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const native = Capacitor.isNativePlatform();
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: getOAuthRedirect(native, window.location.origin),
          ...(native ? { skipBrowserRedirect: true } : {}),
          queryParams: { prompt: "select_account" },
        },
      });
      if (error) throw error;
      if (native) {
        if (!data.url) throw new Error("Google sign-in could not be started.");
        await Browser.open({ url: data.url });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  const titles: Record<Mode, { h: string; sub: string; btn: string }> = {
    signin: { h: "Access LORD", sub: "Sign in to continue.", btn: "Sign In" },
    signup: { h: "Create Identity", sub: "Register a new operator.", btn: "Create Account" },
    forgot: { h: "Reset Access", sub: "We'll email you a reset link.", btn: "Send Reset Link" },
  };
  const t = titles[mode];

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-md px-1">
        <h1 className="mb-1 font-display text-2xl tracking-wide gradient-text text-glow sm:text-3xl">
          {t.h}
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">{t.sub}</p>

        <HudPanel title={t.btn}>
          <form onSubmit={submit} className="space-y-3">
            {mode === "signin" && (
              <>
                <button
                  type="button"
                  onClick={signInWithGoogle}
                  disabled={busy}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-border/60 bg-background/50 px-4 py-2.5 text-sm font-semibold text-foreground transition hover:border-primary hover:bg-primary/10 disabled:opacity-60"
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Chrome className="h-4 w-4 text-primary" />
                  )}
                  Continue with Google
                </button>
                <div className="flex items-center gap-3 py-1">
                  <span className="h-px flex-1 bg-border/60" />
                  <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    or
                  </span>
                  <span className="h-px flex-1 bg-border/60" />
                </div>
              </>
            )}
            {mode === "signup" && (
              <Field icon={UserIcon} label="Name">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className="w-full bg-transparent text-base outline-none sm:text-sm"
                />
              </Field>
            )}
            <Field icon={Mail} label="Email">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@domain.com"
                className="w-full bg-transparent text-base outline-none sm:text-sm"
              />
            </Field>
            {mode !== "forgot" && (
              <Field icon={Lock} label="Password">
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-transparent text-base outline-none sm:text-sm"
                />
              </Field>
            )}

            {error && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            )}
            {info && (
              <p className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-xs text-primary">
                {info}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-[0_0_18px_var(--hud)] transition hover:scale-[1.01] disabled:opacity-60"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {t.btn}
            </button>

            <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
              {mode === "signin" ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setMode("forgot");
                      setError(null);
                      setInfo(null);
                    }}
                    className="text-muted-foreground hover:text-primary"
                  >
                    Forgot password?
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode("signup");
                      setError(null);
                      setInfo(null);
                    }}
                    className="text-muted-foreground hover:text-primary"
                  >
                    Create account →
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setMode("signin");
                    setError(null);
                    setInfo(null);
                  }}
                  className="text-muted-foreground hover:text-primary"
                >
                  ← Back to sign in
                </button>
              )}
            </div>
          </form>
        </HudPanel>

        <div className="mt-4 text-center">
          <Link to="/" className="text-xs text-muted-foreground hover:text-primary">
            ← Back to home
          </Link>
        </div>
      </div>
    </AppShell>
  );
}

function Field({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </span>
      <div className="flex items-center gap-2 rounded-md border border-border/60 bg-background/40 px-3 py-2 focus-within:border-primary">
        <Icon className="h-4 w-4 text-muted-foreground" />
        {children}
      </div>
    </label>
  );
}
