import { createFileRoute } from "@tanstack/react-router";
import { DailyBriefingDashboard } from "@/components/lord/command-center/daily-briefing";

export const Route = createFileRoute("/_authenticated/command-center/")({
  component: Dashboard,
});

function Dashboard() {
  const { user } = Route.useRouteContext();
  return <DailyBriefingDashboard userId={user.id} />;
}
