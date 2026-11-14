import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { getOAuthRedirect } from "@/lib/native-oauth";
import {
  Loader2,
  Mail,
  Lock,
  User as UserIcon,
  Chrome,
  ArrowUpRight,
  Sparkles,
} from "lucide-react";
import "./auth.css";

type Mode = "signin" | "signup" | "forgot";

export const Route = createFileRoute("/auth")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user) {
      throw redirect({ to: "/dashboard", replace: true });
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
    ],
  }),
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
    navigate({ to: "/dashboard", replace: true });
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
            emailRedirectTo: `${window.location.origin}/`,
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
        navigate({ to: "/dashboard", replace: true });
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

  const startGuestAccess = async () => {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const response = await fetch("/api/guest/session", {
        method: "POST",
        credentials: "same-origin",
      });
      const payload = (await response.json().catch(() => null)) as { active?: boolean } | null;
      if (!response.ok || !payload?.active) {
        throw new Error("Guest access could not be started.");
      }
      navigate({ to: "/chat", replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Guest access failed");
    } finally {
      setBusy(false);
    }
  };

  const titles: Record<Mode, { h: string; sub: string; btn: string }> = {
    signin: {
      h: "Welcome Back",
      sub: "Sign in to continue your journey with LORD.",
      btn: "Sign In",
    },
    signup: { h: "Create Identity", sub: "Register a new operator.", btn: "Create Account" },
    forgot: { h: "Reset Access", sub: "We'll email you a reset link.", btn: "Send Reset Link" },
  };
  const t = titles[mode];

  return (
    <main className="auth-page">
      <div className="auth-atmosphere" aria-hidden="true" />
      <div className="auth-ribbons" aria-hidden="true">
        <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
          <defs>
            <linearGradient id="auth-ribbon-blue" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#173bff" stopOpacity="0" />
              <stop offset=".38" stopColor="#087dff" stopOpacity=".9" />
              <stop offset=".7" stopColor="#8c4dff" stopOpacity=".88" />
              <stop offset="1" stopColor="#d78aff" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="auth-ribbon-core" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stopColor="#13a9ff" stopOpacity="0" />
              <stop offset=".52" stopColor="#8bc7ff" stopOpacity=".82" />
              <stop offset=".76" stopColor="#e9b8ff" stopOpacity=".95" />
              <stop offset="1" stopColor="#7745ff" stopOpacity="0" />
            </linearGradient>
            <filter id="auth-ribbon-blur" x="-30%" y="-80%" width="160%" height="260%">
              <feGaussianBlur stdDeviation="24" />
            </filter>
          </defs>
          <path
            className="auth-ribbon auth-ribbon--one"
            d="M-120 750 C 220 570, 280 980, 630 790 S 1040 420, 1720 570"
            stroke="url(#auth-ribbon-blue)"
            strokeWidth="78"
            filter="url(#auth-ribbon-blur)"
          />
          <path
            className="auth-ribbon auth-ribbon--two"
            d="M-120 680 C 220 510, 310 920, 650 735 S 1070 385, 1710 500"
            stroke="url(#auth-ribbon-blue)"
            strokeWidth="28"
          />
          <path
            className="auth-ribbon auth-ribbon--three"
            d="M-80 620 C 260 460, 330 840, 680 690 S 1120 340, 1700 425"
            stroke="url(#auth-ribbon-core)"
            strokeWidth="4"
          />
          <path
            className="auth-ribbon auth-ribbon--four"
            d="M-160 830 C 190 640, 320 1080, 690 865 S 1120 510, 1750 680"
            stroke="url(#auth-ribbon-blue)"
            strokeWidth="3"
          />
        </svg>
      </div>

      <header className="auth-nav-wrap">
        <nav className="auth-nav" aria-label="Main navigation">
          <a className="auth-brand" href="#top" aria-label="LORD AI home">
            <img src="/lord-icon.png" alt="" />
            <span>
              LORD<span className="auth-brand-ai">AI</span>
            </span>
          </a>
          <div className="auth-nav-links">
            <a href="/">Experience</a>
            <a href="/intelligence">Intelligence</a>
            <button
              type="button"
              className="auth-nav-demo"
              onClick={startGuestAccess}
              disabled={busy}
              aria-busy={busy}
            >
              {busy ? "Starting…" : "Demo"}
            </button>
          </div>
        </nav>
      </header>

      <section className="auth-hero" id="top">
        <div className="auth-composition" id="experience">
          <div className="auth-copy-column">
            <div className="auth-heading" id="intelligence">
              <span className="auth-eyebrow">
                <Sparkles size={13} /> PERSONAL AI ASSISTANT
              </span>
              <h1>
                <span>Your Intelligence.</span>
                <strong>Your Command.</strong>
              </h1>
              <p>Work smarter. Think deeper. Achieve more with LORD.</p>
            </div>

            <section className="auth-card" id="access" aria-labelledby="auth-card-title">
              <div className="auth-card-topline">
                <span className="auth-card-signal" />
                <span>SECURE ACCESS</span>
                <span className="auth-card-encrypted">ENCRYPTED</span>
              </div>
              <div className="auth-card-heading">
                <h2 id="auth-card-title">{t.h}</h2>
                <p>{t.sub}</p>
              </div>

              {mode === "signin" && (
                <button
                  type="button"
                  onClick={signInWithGoogle}
                  disabled={busy}
                  className="auth-google-button"
                >
                  {busy ? <Loader2 size={17} className="animate-spin" /> : <Chrome size={17} />}
                  Continue with Google
                </button>
              )}
              {mode === "signin" && (
                <div className="auth-divider">
                  <span /> or continue with email <span />
                </div>
              )}

              <form onSubmit={submit} className="auth-form">
                {mode === "signup" && (
                  <Field icon={UserIcon} label="Name">
                    <input
                      autoComplete="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your name"
                    />
                  </Field>
                )}
                <Field icon={Mail} label="Email address">
                  <input
                    autoComplete="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                </Field>
                {mode !== "forgot" && (
                  <Field icon={Lock} label="Password">
                    <input
                      autoComplete={mode === "signup" ? "new-password" : "current-password"}
                      type="password"
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 6 characters"
                    />
                  </Field>
                )}

                {error && (
                  <p className="auth-feedback auth-feedback-error" role="alert">
                    {error}
                  </p>
                )}
                {info && (
                  <p className="auth-feedback auth-feedback-info" role="status">
                    {info}
                  </p>
                )}

                <button type="submit" disabled={busy} className="auth-submit">
                  {busy && <Loader2 size={16} className="animate-spin" />}
                  {t.btn}
                  <ArrowUpRight size={16} />
                </button>
                <div className="auth-form-links">
                  {mode === "signin" ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setMode("forgot");
                          setError(null);
                          setInfo(null);
                        }}
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
                      >
                        Create account <span>↗</span>
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
                    >
                      ← Back to sign in
                    </button>
                  )}
                </div>
              </form>

              <p className="auth-card-privacy">
                By continuing, you agree to use LORD thoughtfully.{" "}
                <span>Your conversations stay yours.</span>
              </p>
            </section>
          </div>
          <aside className="auth-logo-stage" aria-label="LORD AI holographic emblem">
            <div className="auth-hologram-composition">
              <div className="auth-logo-aura" aria-hidden="true" />
              <svg
                className="auth-logo-orbits"
                viewBox="0 0 700 700"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <ellipse cx="350" cy="350" rx="330" ry="285" />
                <ellipse cx="350" cy="350" rx="290" ry="320" />
                <circle cx="93" cy="286" r="3" />
                <circle cx="594" cy="383" r="2.5" />
                <circle cx="475" cy="94" r="2" />
              </svg>
              <div className="auth-holo-beams" aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
              <div className="auth-holo-particles" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
              </div>
              <div className="auth-hero-logo">
                <picture>
                  <source srcSet="/lord-logo-hologram.webp" type="image/webp" />
                  <img
                    src="/lord-logo-hologram.png"
                    alt="LORD AI"
                    width="788"
                    height="899"
                    decoding="async"
                    loading="eager"
                    fetchPriority="high"
                  />
                </picture>
                <span className="auth-logo-scan" aria-hidden="true" />
              </div>
              <div className="auth-projector" aria-hidden="true">
                <div className="auth-projector-rings">
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
                <div className="auth-projector-deck" />
                <div className="auth-projector-core" />
              </div>
              <div className="auth-logo-caption" aria-hidden="true">
                <span /> PERSONAL INTELLIGENCE <span />
              </div>
            </div>
          </aside>
        </div>
        <footer className="auth-footer">
          <span>© {new Date().getFullYear()} LORD AI</span>
          <span>BUILT FOR WHAT’S NEXT</span>
        </footer>
      </section>
    </main>
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
    <label className="auth-field">
      <span className="auth-field-label">{label}</span>
      <div className="auth-field-control">
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        {children}
      </div>
    </label>
  );
}
