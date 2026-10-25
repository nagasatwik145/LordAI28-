import { describe, expect, it, vi } from "vitest";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import { Route as healthCenterRoute } from "@/routes/api/health-center";
import {
  checkHealthCenterRateLimit,
  createHealthCenterSnapshot,
  summarizeHealthStatus,
  withTimeout,
  type HealthCenterEnvironment,
} from "./health-center.server";

const environment: HealthCenterEnvironment = {
  supabaseConfigured: true,
  openRouterKey: undefined,
  openAiKey: undefined,
  geminiKey: undefined,
  additionalAiProviderConfigured: false,
  tavilyKey: undefined,
  gameProviderConfigured: false,
  proEnabled: false,
};

function snapshotOptions(
  overrides: Partial<Parameters<typeof createHealthCenterSnapshot>[0]> = {},
) {
  return {
    databaseCheck: vi.fn().mockResolvedValue(undefined),
    requestSignal: new AbortController().signal,
    activeChecks: false,
    environment,
    now: () => new Date("2026-10-25T00:00:00.000Z"),
    ...overrides,
  };
}

describe("health center status classification", () => {
  it("registers Supabase request authentication on the diagnostics API", () => {
    expect(healthCenterRoute.options.server?.middleware).toContain(requireSupabaseRequestAuth);
  });

  it("does not count unconfigured or untested optional services as core failures", async () => {
    const result = await createHealthCenterSnapshot(snapshotOptions());

    expect(result.status).toBe("Healthy");
    expect(result.checks).toHaveLength(12);
    expect(result.checks.find((check) => check.id === "ai-provider")?.status).toBe(
      "Not Configured",
    );
    expect(result.checks.find((check) => check.id === "voice-speech")?.status).toBe("Not Tested");
  });

  it("marks a configured provider Not Tested until an active check is requested", async () => {
    const result = await createHealthCenterSnapshot(
      snapshotOptions({
        environment: { ...environment, openRouterKey: "server-secret" },
      }),
    );

    expect(result.checks.find((check) => check.id === "ai-provider")).toMatchObject({
      status: "Not Tested",
      verification: "not-tested",
    });
  });

  it("verifies only a provider model catalog and never returns provider content or credentials", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBeUndefined();
      return Response.json({ data: [{ id: "example-model" }] });
    });
    const result = await createHealthCenterSnapshot(
      snapshotOptions({
        activeChecks: true,
        environment: { ...environment, openRouterKey: "server-secret" },
        fetcher,
      }),
    );

    expect(fetcher).toHaveBeenCalledOnce();
    expect(result.checks.find((check) => check.id === "ai-provider")).toMatchObject({
      status: "Healthy",
      verification: "connectivity",
    });
    expect(JSON.stringify(result)).not.toContain("server-secret");
    expect(JSON.stringify(result)).not.toContain("example-model");
  });

  it("classifies database failures without exposing raw provider or database errors", async () => {
    const result = await createHealthCenterSnapshot(
      snapshotOptions({
        databaseCheck: vi.fn().mockRejectedValue(new Error("password=private-value")),
        activeChecks: true,
        environment: { ...environment, openRouterKey: "private-key" },
        fetcher: vi
          .fn()
          .mockResolvedValue(
            Response.json({ error: "upstream private response" }, { status: 503 }),
          ),
      }),
    );
    const response = JSON.stringify(result);

    expect(result.status).toBe("Unavailable");
    expect(result.checks.find((check) => check.id === "database")?.status).toBe("Unavailable");
    expect(response).not.toContain("private-value");
    expect(response).not.toContain("private-key");
    expect(response).not.toContain("upstream private response");
  });

  it("marks database timeouts as degraded and aborts the operation", async () => {
    const operation = vi.fn(
      (signal: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    );
    await expect(withTimeout(operation, 5)).rejects.toMatchObject({ name: "TimeoutError" });
    expect(operation.mock.calls[0]?.[0].aborted).toBe(true);
  });

  it("uses the worst service state when summarizing checks", async () => {
    const result = await createHealthCenterSnapshot(snapshotOptions());
    expect(summarizeHealthStatus(result.checks)).toBe("Healthy");
    expect(
      summarizeHealthStatus([
        ...result.checks,
        {
          id: "web-search",
          label: "Web search",
          status: "Unavailable",
          summary: "",
          verification: "connectivity",
          checkedAt: result.checkedAt,
        },
      ]),
    ).toBe("Degraded");
  });

  it("limits repeated diagnostics requests per authenticated user", () => {
    const userId = `health-center-test-${crypto.randomUUID()}`;
    for (let request = 0; request < 8; request += 1) {
      expect(checkHealthCenterRateLimit(userId, 1_000)).toBe(true);
    }
    expect(checkHealthCenterRateLimit(userId, 1_001)).toBe(false);
    expect(checkHealthCenterRateLimit(userId, 61_001)).toBe(true);
  });
});
