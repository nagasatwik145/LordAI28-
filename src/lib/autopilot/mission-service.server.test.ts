import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  abortLocalMission,
  approveMission,
  checkMissionPlanningRateLimit,
  controlMission,
  createMissionPlan,
  executeMissionStep,
  MissionServiceError,
  type MissionExecutor,
} from "./mission-service.server";
import type { MissionPlan } from "./mission-engine";
import type { MissionRecord, MissionStore } from "./mission-store.server";

const mocks = vi.hoisted(() => ({
  hasProEntitlement: vi.fn(),
  runLordText: vi.fn(),
}));

vi.mock("@/lib/billing/entitlements.server", () => ({
  hasProEntitlement: mocks.hasProEntitlement,
}));
vi.mock("@/lib/lord/llm", () => ({
  runLordText: mocks.runLordText,
}));

const userId = "user-123";
const identity = { id: userId, email_confirmed_at: "2026-01-01T00:00:00.000Z" };

function createPlan(): MissionPlan {
  return {
    title: "Explain a topic",
    summary: "Answer the user's question.",
    questions: [],
    steps: [
      {
        id: "answer",
        action: "study.explain",
        arguments: { question: "What is a closure?" },
        description: "Explain closures",
        expectedResult: "A clear explanation",
        dependencies: [],
        timeoutMs: 30_000,
        retryPolicy: { maxRetries: 1, recoverableOnly: true },
        requiresApproval: false,
        status: "pending",
        attempts: 0,
      },
    ],
  };
}

function memoryStore(initial?: MissionRecord): MissionStore & { current: MissionRecord | null } {
  let current = initial ? structuredClone(initial) : null;
  return {
    get current() {
      return current ? structuredClone(current) : null;
    },
    async get(id, requestedUserId) {
      if (!current || current.id !== id || current.userId !== requestedUserId) return null;
      return structuredClone(current);
    },
    async list(requestedUserId) {
      return current?.userId === requestedUserId ? [structuredClone(current)] : [];
    },
    async create(input) {
      current = {
        id: "mission-123",
        userId: input.userId,
        objective: input.objective,
        status: input.status,
        plan: structuredClone(input.plan),
        result: null,
        executionLeaseUntil: null,
        revision: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      return structuredClone(current);
    },
    async compareAndSwap(record, expectedRevision) {
      if (!current || current.revision !== expectedRevision || current.userId !== record.userId) {
        return null;
      }
      current = {
        ...structuredClone(record),
        revision: expectedRevision + 1,
        updatedAt: new Date().toISOString(),
      };
      return structuredClone(current);
    },
  };
}

function plannedMission(): MissionRecord {
  return {
    id: "mission-123",
    userId,
    objective: "Explain closures",
    status: "planned",
    plan: createPlan(),
    result: null,
    executionLeaseUntil: null,
    revision: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("mission service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasProEntitlement.mockResolvedValue(true);
  });

  it("enforces subscription entitlements before creating a mission", async () => {
    mocks.hasProEntitlement.mockResolvedValue(false);
    const store = memoryStore();
    await expect(
      createMissionPlan(store, { userId, identity, objective: "Explain closures" }),
    ).rejects.toMatchObject({ kind: "forbidden" });
    expect(store.current).toBeNull();
  });

  it("persists validated plans and prevents a different owner from controlling them", async () => {
    const previousKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "configured";
    mocks.runLordText.mockResolvedValue({
      text: JSON.stringify({
        title: "Explain closures",
        summary: "Provide a concise explanation.",
        questions: [],
        steps: [
          {
            id: "answer",
            action: "study.explain",
            arguments: { question: "What is a closure?" },
            description: "Explain closures",
            expectedResult: "A clear explanation",
            dependencies: [],
            timeoutMs: 30_000,
          },
        ],
      }),
      modelId: "test-model",
      provider: "test",
      attemptedModelIds: ["test-model"],
    });
    const store = memoryStore();
    try {
      const mission = await createMissionPlan(store, {
        userId,
        identity,
        objective: "Explain closures",
      });
      expect(mission.status).toBe("planned");
      expect(mission.plan.steps[0]?.status).toBe("pending");
      await expect(controlMission(store, "other-user", mission.id, "cancel")).rejects.toMatchObject(
        {
          kind: "not_found",
        },
      );
    } finally {
      if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previousKey;
    }
  });

  it("approves a game step while preserving its approval requirement in the plan", async () => {
    const mission = plannedMission();
    mission.status = "needs_approval";
    mission.plan.steps[0] = {
      ...mission.plan.steps[0]!,
      action: "jalwa.create",
      arguments: { prompt: "A neon maze with three levels" },
      requiresApproval: true,
      retryPolicy: { maxRetries: 0, recoverableOnly: true },
    };
    const store = memoryStore(mission);

    const approved = await approveMission(store, userId, mission.id);

    expect(approved.status).toBe("planned");
    expect(approved.plan.steps[0]?.requiresApproval).toBe(false);
  });

  it("executes dependency-ready steps and stores verified results", async () => {
    const plan = createPlan();
    plan.steps.push({
      id: "follow-up",
      action: "chat.respond",
      arguments: { prompt: "Summarize the explanation." },
      description: "Summarize the result",
      expectedResult: "A summary",
      dependencies: ["answer"],
      timeoutMs: 30_000,
      retryPolicy: { maxRetries: 1, recoverableOnly: true },
      requiresApproval: false,
      status: "pending",
      attempts: 0,
    });
    const store = memoryStore({ ...plannedMission(), plan });
    const execute: MissionExecutor = async ({ step }) => ({ content: `Verified ${step.id}` });

    const first = await executeMissionStep(store, userId, "mission-123", identity, execute);
    expect(first.status).toBe("planned");
    expect(first.plan.steps[0]?.status).toBe("completed");
    expect(first.plan.steps[1]?.status).toBe("pending");

    const second = await executeMissionStep(store, userId, "mission-123", identity, execute);
    expect(second.status).toBe("completed");
    expect(second.plan.steps[1]?.result?.content).toBe("Verified follow-up");
    expect(second.result).not.toBeNull();
  });

  it("bounds automatic retries and records the failure before recovery", async () => {
    const store = memoryStore(plannedMission());
    const fail: MissionExecutor = async () => {
      throw new Error("sensitive upstream detail");
    };
    const failedAttempt = await executeMissionStep(store, userId, "mission-123", identity, fail);
    expect(failedAttempt.status).toBe("planned");
    expect(failedAttempt.plan.steps[0]?.status).toBe("retrying");
    expect(failedAttempt.plan.steps[0]?.result?.error).not.toContain("sensitive");

    const recovered = await executeMissionStep(
      store,
      userId,
      "mission-123",
      identity,
      async () => ({ content: "Verified after retry" }),
    );
    expect(recovered.status).toBe("completed");
    expect(recovered.plan.steps[0]?.attempts).toBe(2);
  });

  it("pauses active execution and preserves an interrupted step for safe resume", async () => {
    const store = memoryStore(plannedMission());
    let signal: AbortSignal | undefined;
    let started!: () => void;
    const startedExecution = new Promise<void>((resolve) => {
      started = resolve;
    });
    const execute: MissionExecutor = async (input) => {
      signal = input.signal;
      started();
      return new Promise((_resolve, reject) => {
        input.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    };

    const execution = executeMissionStep(store, userId, "mission-123", identity, execute);
    await startedExecution;
    expect(signal?.aborted).toBe(false);
    await controlMission(store, userId, "mission-123", "pause");
    abortLocalMission(userId, "mission-123");
    const paused = await execution;
    expect(paused.status).toBe("paused");
    expect(paused.plan.steps[0]?.status).toBe("retrying");
    expect(signal?.aborted).toBe(true);
  });

  it("cancels active execution without persisting a late tool result", async () => {
    const store = memoryStore(plannedMission());
    let started!: () => void;
    const startedExecution = new Promise<void>((resolve) => {
      started = resolve;
    });
    const execute: MissionExecutor = async ({ signal }) => {
      started();
      return new Promise((resolve) => {
        signal.addEventListener("abort", () => resolve({ content: "late tool result" }), {
          once: true,
        });
      });
    };

    const execution = executeMissionStep(store, userId, "mission-123", identity, execute);
    await startedExecution;
    await controlMission(store, userId, "mission-123", "cancel");
    abortLocalMission(userId, "mission-123");
    const cancelled = await execution;

    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.plan.steps[0]?.status).toBe("skipped");
    expect(cancelled.plan.steps[0]?.result?.content).not.toBe("late tool result");
  });

  it("enforces per-user planning rate limits", () => {
    const now = 1_000_000;
    for (let index = 0; index < 5; index += 1) {
      expect(checkMissionPlanningRateLimit(`rate-user-${now}`, now + index)).toBe(true);
    }
    expect(checkMissionPlanningRateLimit(`rate-user-${now}`, now + 10)).toBe(false);
    expect(checkMissionPlanningRateLimit(`rate-user-${now}`, now + 3_600_001)).toBe(true);
  });
});
