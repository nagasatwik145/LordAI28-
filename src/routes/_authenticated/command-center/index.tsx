import { createFileRoute } from "@tanstack/react-router";
import { PersonalDashboard } from "@/components/lord/command-center/personal-dashboard";

export const Route = createFileRoute("/_authenticated/command-center/")({
  component: Dashboard,
});

function Dashboard() {
  const { user } = Route.useRouteContext();
  return <PersonalDashboard userId={user.id} />;
}
