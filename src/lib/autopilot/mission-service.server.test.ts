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
    async getByIdempotencyKey(requestedUserId, idempotencyKey) {
      if (
        !current ||
        current.userId !== requestedUserId ||
        current.idempotencyKey !== idempotencyKey
      ) {
        return null;
      }
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
        events: structuredClone(input.events ?? []),
        idempotencyKey: input.idempotencyKey ?? null,
        approvedScopeHash: null,
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
    events: [],
    idempotencyKey: null,
    approvedScopeHash: null,
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

  it("returns one persisted mission for duplicate planning requests", async () => {
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
    });
    const store = memoryStore();
    try {
      const first = await createMissionPlan(store, {
        userId,
        identity,
        objective: "Explain closures",
        idempotencyKey: "f04d6b3e-7b7d-4d63-8949-32acbf3c1599",
      });
      const duplicate = await createMissionPlan(store, {
        userId,
        identity,
        objective: "Explain closures",
        idempotencyKey: "f04d6b3e-7b7d-4d63-8949-32acbf3c1599",
      });
      expect(duplicate.id).toBe(first.id);
      expect(mocks.runLordText).toHaveBeenCalledTimes(1);
      await expect(
        createMissionPlan(store, {
          userId,
          identity,
          objective: "Different goal",
          idempotencyKey: "f04d6b3e-7b7d-4d63-8949-32acbf3c1599",
        }),
      ).rejects.toMatchObject({ kind: "conflict" });
    } finally {
      if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previousKey;
    }
  });

  it("binds approval to the reviewed action scope", async () => {
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
    expect(approved.plan.steps[0]?.requiresApproval).toBe(true);
    expect(approved.approvedScopeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(approved.events.at(-1)?.type).toBe("approved");
  });

  it("requests fresh approval when a consequential action changes", async () => {
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
    const changed = structuredClone(approved);
    changed.plan.steps[0]!.arguments = { prompt: "A different maze with three levels" };
    await store.compareAndSwap(changed, approved.revision);
    const execute = vi.fn(async () => ({ content: "Must not run" }));

    const result = await executeMissionStep(store, userId, mission.id, identity, execute);

    expect(result.status).toBe("needs_approval");
    expect(result.events.at(-1)?.message).toContain("changed");
    expect(execute).not.toHaveBeenCalled();
  });

  it("serializes concurrent workers and records persisted step events", async () => {
    const store = memoryStore(plannedMission());
    let markStarted!: () => void;
    let finish!: (result: { content: string }) => void;
    let executionCalls = 0;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const execute: MissionExecutor = async () => {
      executionCalls += 1;
      markStarted();
      return new Promise((resolve) => {
        finish = resolve;
      });
    };

    const worker = executeMissionStep(store, userId, "mission-123", identity, execute);
    await started;
    const concurrent = await executeMissionStep(store, userId, "mission-123", identity, execute);
    expect(concurrent.status).toBe("running");
    expect(executionCalls).toBe(1);
    finish({ content: "Verified once" });
    const completed = await worker;

    expect(completed.plan.steps[0]?.status).toBe("completed");
    expect(completed.events.map((event) => event.type)).toContain("step_started");
    expect(completed.events.map((event) => event.type)).toContain("step_completed");
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

  it("blocks dependent work after its prerequisite exhausts retries", async () => {
    vi.useFakeTimers();
    const plan = createPlan();
    plan.steps.push({
      ...plan.steps[0]!,
      id: "dependent",
      dependencies: ["answer"],
    });
    const store = memoryStore({ ...plannedMission(), plan });
    const fail: MissionExecutor = async () => {
      throw new Error("temporary failure");
    };
    try {
      const firstAttempt = await executeMissionStep(store, userId, "mission-123", identity, fail);
      vi.setSystemTime(new Date(Date.parse(firstAttempt.plan.steps[0]!.retryAt!) + 1));
      const finalAttempt = await executeMissionStep(store, userId, "mission-123", identity, fail);

      expect(finalAttempt.status).toBe("failed");
      expect(finalAttempt.plan.steps[0]?.status).toBe("failed");
      expect(finalAttempt.plan.steps[1]?.status).toBe("skipped");
      expect(finalAttempt.events.some((event) => event.type === "step_blocked")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("recovers an expired worker lease and retries only after persisted backoff", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-25T06:00:00.000Z"));
    const mission = plannedMission();
    mission.status = "running";
    mission.executionLeaseUntil = new Date(Date.now() - 130_000).toISOString();
    mission.plan.steps[0] = {
      ...mission.plan.steps[0]!,
      status: "running",
      attempts: 1,
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      lastAttemptAt: new Date(Date.now() - 60_000).toISOString(),
    };
    const store = memoryStore(mission);
    const execute: MissionExecutor = async () => ({ content: "Recovered safely" });
    try {
      const recovered = await executeMissionStep(store, userId, mission.id, identity, execute);
      expect(recovered.status).toBe("planned");
      expect(recovered.plan.steps[0]?.status).toBe("retrying");
      expect(recovered.events.some((event) => event.type === "recovered")).toBe(true);

      vi.advanceTimersByTime(1_001);
      const completed = await executeMissionStep(store, userId, mission.id, identity, execute);
      expect(completed.status).toBe("completed");
      expect(completed.plan.steps[0]?.attempts).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("enforces tool timeouts even when an adapter ignores its abort signal", async () => {
    const mission = plannedMission();
    mission.plan.steps[0]!.timeoutMs = 1_000;
    const store = memoryStore(mission);
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const execution = executeMissionStep(store, userId, mission.id, identity, async () => {
      markStarted();
      return new Promise(() => {});
    });

    await started;
    const timedOut = await execution;

    expect(timedOut.status).toBe("planned");
    expect(timedOut.plan.steps[0]?.status).toBe("retrying");
    expect(timedOut.plan.steps[0]?.result?.error).toBeDefined();
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
    expect(failedAttempt.plan.steps[0]?.retryAt).toBeDefined();
    expect(failedAttempt.events.at(-1)?.type).toBe("step_retry_scheduled");

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(Date.parse(failedAttempt.plan.steps[0]!.retryAt!) + 1));
      const recovered = await executeMissionStep(
        store,
        userId,
        "mission-123",
        identity,
        async () => ({ content: "Verified after retry" }),
      );
      expect(recovered.status).toBe("completed");
      expect(recovered.plan.steps[0]?.attempts).toBe(2);
      expect(recovered.plan.steps[0]?.startedAt).toBeDefined();
      expect(recovered.plan.steps[0]?.completedAt).toBeDefined();
      expect(recovered.events.some((event) => event.type === "step_completed")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
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
    await expect(controlMission(store, userId, "mission-123", "resume")).rejects.toMatchObject({
      kind: "busy",
    });
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
