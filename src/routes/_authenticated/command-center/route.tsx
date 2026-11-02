import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/components/lord/AppShell";
import { CommandCenterShell } from "@/components/lord/command-center/shell";

export const Route = createFileRoute("/_authenticated/command-center")({
  component: CommandCenterLayout,
});

function CommandCenterLayout() {
  return (
    <AppShell>
      <CommandCenterShell>
        <Outlet />
      </CommandCenterShell>
    </AppShell>
  );
}
