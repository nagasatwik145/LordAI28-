import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { motion, useReducedMotion } from "framer-motion";
import { Settings, LogOut, LogIn, User as UserIcon, Menu, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { ParticleField } from "./ParticleField";
import { WakeIndicator } from "./WakeIndicator";
import { HealthHud } from "./HealthHud";
import { NavigationDock } from "./NavigationDock";
import { PRIMARY_NAVIGATION, SECONDARY_NAVIGATION } from "./app-navigation";
import { AppCommandPalette } from "@/features/command-palette/app-command-palette";

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const path = location.pathname;
  const reduceMotion = useReducedMotion();

  const [user, setUser] = useState<User | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    let savedTheme: string | null = null;
    try {
      savedTheme = window.localStorage.getItem("lord-theme");
    } catch {
      // Storage may be unavailable in private browsing; the default is dark.
    }
    const isLight = savedTheme === "light";
    document.documentElement.classList.toggle("light", isLight);
    document.documentElement.classList.toggle("dark", !isLight);
  }, []);

  useEffect(() => {
    let mounted = true;

    const ensureUserDefaults = async (user: User) => {
      try {
        await supabase.from("profiles").upsert(
          {
            id: user.id,
            email: user.email,
            name:
              ((user.user_metadata as Record<string, unknown>)?.name as string | undefined) ??
              user.email?.split("@")[0] ??
              null,
          },
          { onConflict: "id" },
        );
        await supabase.from("user_settings").upsert(
          {
            user_id: user.id,
          },
          { onConflict: "user_id" },
        );
      } catch (e) {
        console.error("Failed to ensure user profile/settings", e);
      }
    };

    const initializeSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      const user = data.session?.user ?? null;
      setUser(user);
      if (user) {
        await ensureUserDefaults(user);
      }
    };

    initializeSession();

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      const user = session?.user ?? null;
      if (!mounted) return;
      setUser(user);
      if (user) {
        void ensureUserDefaults(user);
      }
    });

    return () => {
      mounted = false;
      authListener?.subscription.unsubscribe();
    };
  }, [navigate]);

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden">
      <ParticleField />
      <div className="pointer-events-none fixed inset-0 -z-10 bg-grid opacity-[0.07]" />

      {/* Top status bar */}
      <header className="mobile-safe-top sticky top-0 z-40 border-b border-border/60 bg-background/90 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3 px-4 py-3 sm:gap-4 sm:px-6 md:px-8">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <button
              onClick={() => setDrawerOpen(true)}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border bg-card/70 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" />
            </button>
            <Link to="/" className="flex min-w-0 items-center gap-3">
              <motion.svg
                aria-hidden="true"
                viewBox="0 0 400 400"
                className="lord-brand-mark h-9 w-9 shrink-0 text-[#4f8dff]"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                initial={reduceMotion ? false : { opacity: 0, scale: 0.94, rotate: -4 }}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                whileHover={reduceMotion ? undefined : { rotate: 4, scale: 1.03 }}
                whileTap={reduceMotion ? undefined : { scale: 0.97 }}
                transition={{ duration: 0.28, ease: "easeOut" }}
                style={{ transformOrigin: "center" }}
              >
                <g
                  stroke="currentColor"
                  strokeWidth="12"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M105 52C151 44 224 105 281 166C334 223 361 286 344 329C326 373 262 330 202 273C142 216 82 143 73 92C67 61 84 49 105 52Z" />
                  <path d="M295 52C249 44 176 105 119 166C66 223 39 286 56 329C74 373 138 330 198 273C258 216 318 143 327 92C333 61 316 49 295 52Z" />
                  <path d="M140 184L197 245L264 178" />
                </g>
              </motion.svg>
              <div className="min-w-0 leading-tight">
                <div className="truncate font-display text-lg font-bold tracking-wider gradient-text">
                  LORD
                </div>
                <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                  AI
                </div>
              </div>
            </Link>
          </div>

          <AppCommandPalette />
          {user ? <UserMenu user={user} onSignOut={signOut} /> : <SignInButton />}
        </div>
      </header>

      <NavigationDock />

      <main className="mobile-app-main px-4 pb-28 pt-4 sm:px-6 md:px-8 md:pb-10 md:pl-24">
        <motion.div
          key={path}
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.3, ease: [0.22, 1, 0.36, 1] }}
        >
          {children}
        </motion.div>
      </main>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
          <button
            className="absolute inset-0 bg-background/70 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close navigation overlay"
          />
          <aside className="mobile-safe-top mobile-safe-bottom hud-panel absolute bottom-0 left-0 top-0 flex w-[min(86vw,22rem)] flex-col gap-4 overflow-y-auto rounded-r-2xl border-l-0 border-t-0 p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-display text-lg font-bold gradient-text">LORD</div>
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Mobile command
                </div>
              </div>
              <button
                onClick={() => setDrawerOpen(false)}
                className="grid h-10 w-10 place-items-center rounded-md border border-border/60 text-muted-foreground"
                aria-label="Close navigation"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <HealthHud compact />
            <ul className="grid gap-2">
              {SECONDARY_NAVIGATION.map(({ to, label, icon: Icon }) => {
                const active = to === "/" ? path === "/" : path.startsWith(to);
                return (
                  <li key={to}>
                    <Link
                      to={to}
                      onClick={() => setDrawerOpen(false)}
                      className={cn(
                        "flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm transition-colors duration-200",
                        active
                          ? "bg-primary/12 text-primary"
                          : "text-muted-foreground hover:bg-primary/10 hover:text-primary",
                      )}
                    >
                      <Icon className="h-5 w-5 shrink-0" />
                      <span>{label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </aside>
        </div>
      )}

      {/* Bottom nav (mobile) */}
      <nav className="mobile-safe-bottom fixed bottom-0 left-0 right-0 z-40 px-2 pb-2 md:hidden">
        <ul className="glass-panel grid grid-cols-4 gap-1.5 p-2">
          {PRIMARY_NAVIGATION.map(({ to, label, icon: Icon }) => {
            const active = to === "/" ? path === "/" : path.startsWith(to);
            return (
              <li key={to} className="min-w-0">
                <Link
                  to={to}
                  className={cn(
                    "flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 text-[10px] transition-colors duration-200",
                    active
                      ? "bg-primary/12 text-primary"
                      : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="truncate uppercase tracking-wider">{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <WakeIndicator />
    </div>
  );
}

function SignInButton() {
  return (
    <Link
      to="/auth"
      className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
    >
      <LogIn className="h-3.5 w-3.5" /> Sign in
    </Link>
  );
}

function UserMenu({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const initial =
    (user.user_metadata?.name as string | undefined)?.[0]?.toUpperCase() ??
    user.email?.[0]?.toUpperCase() ??
    "U";
  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-background/40 text-sm font-semibold text-primary transition hover:border-primary"
        aria-label="User menu"
      >
        {initial}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="hud-panel absolute right-0 top-11 z-50 w-56 p-2 text-sm">
            <div className="border-b border-border/40 px-2 py-2 text-xs">
              <div className="flex items-center gap-2 font-medium">
                <UserIcon className="h-3.5 w-3.5 text-primary" />
                <span className="truncate">
                  {(user.user_metadata?.name as string | undefined) ?? "Operator"}
                </span>
              </div>
              <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{user.email}</div>
            </div>
            <Link
              to="/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded px-2 py-2 text-xs text-muted-foreground transition hover:bg-primary/10 hover:text-primary"
            >
              <Settings className="h-3.5 w-3.5" /> Settings
            </Link>
            <button
              onClick={onSignOut}
              className="flex w-full items-center gap-2 rounded px-2 py-2 text-xs text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
            >
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
