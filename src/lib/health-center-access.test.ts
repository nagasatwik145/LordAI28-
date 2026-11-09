import { describe, expect, it } from "vitest";
import { requireHealthCenterAdmin } from "@/integrations/supabase/auth-middleware";
import { Route as healthCenterRoute } from "@/routes/api/health-center";
import { Route as systemDiagnosticsRoute } from "@/routes/api/observability/health";
import { isAuthorizedHealthCenterUser } from "./health-center-access";

describe("Health Center server authorization", () => {
  it("accepts only the verified allowlisted account", () => {
    expect(
      isAuthorizedHealthCenterUser({
        email: "NagaSatwik145@gmail.com",
        email_confirmed_at: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      isAuthorizedHealthCenterUser({
        email: "nagasatwik145@gmail.com",
        email_confirmed_at: null,
      }),
    ).toBe(false);
    expect(
      isAuthorizedHealthCenterUser({
        email: "other@example.com",
        email_confirmed_at: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe(false);
  });

  it("enforces the same verified-account middleware on both diagnostics APIs", () => {
    expect(healthCenterRoute.options.server?.middleware).toContain(requireHealthCenterAdmin);
    expect(systemDiagnosticsRoute.options.server?.middleware).toContain(requireHealthCenterAdmin);
  });
});
