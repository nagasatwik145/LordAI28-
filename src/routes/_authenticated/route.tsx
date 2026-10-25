import { createFileRoute, Outlet, redirect, useLocation } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeSync } from "@/lib/realtime/use-realtime-sync";
import { createDueNotifications, useTasks } from "@/lib/task-store";
import { onDashboardEvent } from "@/lib/dashboard-service";
import { toast } from "sonner";
import { authenticatedFetch } from "@/lib/authenticated-fetch";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session?.user) {
      throw redirect({ to: "/auth" });
    }
    return { user: data.session.user };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { user } = Route.useRouteContext();
  const pathname = useLocation({ select: (location) => location.pathname });

  // Single, app-wide realtime sync: binds the shared RealtimeManager to this
  // user and routes conversation/message events into React Query. Mounted once
  // here so every authenticated page (chat, sidebar, dashboard) shares the same
  // websocket. Automatically unsubscribes when the user logs out (user -> null)
  // because the route redirects to /auth.
  useRealtimeSync(user?.id);
  const { tasks, refresh } = useTasks(user?.id);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  useEffect(() => {
    const feature = pathname.startsWith("/study") ? "study" : pathname.startsWith("/chat") ? "chat" : pathname.startsWith("/games") ? "games" : pathname.startsWith("/voice") ? "missions" : pathname.startsWith("/images") ? "images" : "workspace";
    void authenticatedFetch("/api/analytics/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "feature_opened", feature }) }).catch(() => undefined);
  }, [pathname]);

  useEffect(() => {
    if (!user?.id) return;
    // A persistent database/schema failure should not trigger a request every
    // minute for the lifetime of this authenticated session. A fresh session retries it.
    let reminderSyncFailed = false;
    const checkDue = () => {
      if (reminderSyncFailed) return;
      void createDueNotifications(user.id, tasksRef.current).catch((error) => {
        reminderSyncFailed = true;
        console.error("Could not update task reminders", error);
        toast.error("Could not update task reminders", {
          description: error instanceof Error ? error.message : "A database request failed.",
        });
      });
    };
    checkDue();
    const timer = window.setInterval(checkDue, 60_000);
    const unsubscribe = onDashboardEvent((kind) => {
      if (kind === "tasks" || kind === "all") void refresh();
    });
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refresh();
        checkDue();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user?.id, refresh]);

  return <Outlet />;
}
