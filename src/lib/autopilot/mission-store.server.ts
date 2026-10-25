import "@tanstack/react-start/server-only";
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";
import {
  ALL_MISSION_ACTIONS,
  MissionActionSchema,
  type MissionEvent,
  type MissionPlan,
  type MissionStatus,
  validateMissionPlan,
} from "./mission-engine";
const MissionEventSchema = z
  .object({
    id: z.string().uuid(),
    type: z.string().min(1).max(60),
    timestamp: z.string().datetime(),
    message: z.string().min(1).max(500),
    stepId: z.string().max(40).optional(),
  })
  .strict();
const MissionStatusSchema = z.enum([
  "planning",
  "needs_clarification",
  "needs_approval",
  "planned",
  "running",
  "paused",
  "cancelled",
  "completed",
  "failed",
]);
const MissionPlanSchema = z
  .object({
    title: z.string().min(1).max(120),
    summary: z.string().min(1).max(500),
    questions: z.array(z.string().min(1).max(300)).max(3),
    steps: z
      .array(
        z
          .object({
            id: z.string(),
            action: MissionActionSchema,
            arguments: z.record(z.string(), z.unknown()),
            description: z.string(),
            expectedResult: z.string(),
            dependencies: z.array(z.string()),
            timeoutMs: z.number().int(),
            retryPolicy: z.object({
              maxRetries: z.number().int(),
              recoverableOnly: z.literal(true),
            }),
            requiresApproval: z.boolean(),
            status: z.enum(["pending", "running", "retrying", "completed", "failed", "skipped"]),
            attempts: z.number().int(),
            startedAt: z.string().datetime().optional(),
            lastAttemptAt: z.string().datetime().optional(),
            retryAt: z.string().datetime().optional(),
            completedAt: z.string().datetime().optional(),
            result: z
              .object({
                content: z.string().max(20_000).optional(),
                modelId: z.string().max(100).optional(),
                provider: z.string().max(100).optional(),
                toolName: z.string().max(100).optional(),
                data: z.unknown().optional(),
                error: z.string().max(1_000).optional(),
              })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .max(8),
  })
  .strict();

export interface MissionRecord {
  id: string;
  userId: string;
  objective: string;
  status: MissionStatus;
  plan: MissionPlan;
  result: Json | null;
  events: MissionEvent[];
  idempotencyKey: string | null;
  approvedScopeHash: string | null;
  executionLeaseUntil: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

type MissionRow = {
  id: string;
  user_id: string;
  objective: string;
  status: string;
  plan: Json;
  result: Json | null;
  events: Json;
  idempotency_key: string | null;
  approved_scope_hash: string | null;
  execution_lease_until: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
};

type MissionQuery = {
  select(columns: string): MissionQuery;
  eq(column: string, value: string | number): MissionQuery;
  order(column: string, options: { ascending: boolean }): MissionQuery;
  limit(count: number): Promise<{ data: MissionRow[] | null; error: unknown }>;
  insert(values: Record<string, unknown>): MissionQuery;
  update(values: Record<string, unknown>): MissionQuery;
  single(): Promise<{ data: MissionRow | null; error: unknown }>;
  maybeSingle(): Promise<{ data: MissionRow | null; error: unknown }>;
};

export interface MissionDatabase {
  from(table: "autopilot_missions"): MissionQuery;
}

export class MissionPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissionPersistenceError";
  }
}

export interface MissionStore {
  get(id: string, userId: string): Promise<MissionRecord | null>;
  getByIdempotencyKey(userId: string, idempotencyKey: string): Promise<MissionRecord | null>;
  list(userId: string, limit?: number): Promise<MissionRecord[]>;
  create(input: {
    userId: string;
    objective: string;
    status: MissionStatus;
    plan: MissionPlan;
    idempotencyKey?: string;
    events?: MissionEvent[];
  }): Promise<MissionRecord>;
  compareAndSwap(record: MissionRecord, expectedRevision: number): Promise<MissionRecord | null>;
}

function toMissionRecord(row: MissionRow): MissionRecord {
  if (!MissionStatusSchema.safeParse(row.status).success || !Number.isInteger(row.revision)) {
    throw new MissionPersistenceError("Saved mission metadata is invalid.");
  }
  const plan = MissionPlanSchema.parse(row.plan);
  const events = z.array(MissionEventSchema).max(100).parse(row.events);
  if (!(
    (row.status === "planning" || row.status === "failed") &&
    plan.steps.length === 0 &&
    plan.questions.length === 0
  )) {
    validateMissionPlan(plan, ALL_MISSION_ACTIONS, true);
  }
  return {
    id: row.id,
    userId: row.user_id,
    objective: row.objective,
    status: row.status as MissionStatus,
    plan,
    result: row.result,
    events,
    idempotencyKey: row.idempotency_key,
    approvedScopeHash: row.approved_scope_hash,
    executionLeaseUntil: row.execution_lease_until,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const COLUMNS =
  "id,user_id,objective,status,plan,result,events,idempotency_key,approved_scope_hash,execution_lease_until,revision,created_at,updated_at";

export function createMissionStore(db: MissionDatabase): MissionStore {
  return {
    async get(id, userId) {
      const { data, error } = await db
        .from("autopilot_missions")
        .select(COLUMNS)
        .eq("id", id)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw new MissionPersistenceError("Mission could not be loaded.");
      return data ? toMissionRecord(data) : null;
    },

    async getByIdempotencyKey(userId, idempotencyKey) {
      const { data, error } = await db
        .from("autopilot_missions")
        .select(COLUMNS)
        .eq("user_id", userId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (error) throw new MissionPersistenceError("Mission request could not be loaded.");
      return data ? toMissionRecord(data) : null;
    },

    async list(userId, limit = 20) {
      const { data, error } = await db
        .from("autopilot_missions")
        .select(COLUMNS)
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(Math.min(Math.max(Math.floor(limit), 1), 20));
      if (error) throw new MissionPersistenceError("Missions could not be loaded.");
      return (data ?? []).map(toMissionRecord);
    },

    async create(input) {
      const { data, error } = await db
        .from("autopilot_missions")
        .insert({
          user_id: input.userId,
          objective: input.objective,
          status: input.status,
          plan: input.plan as unknown as Json,
          result: null,
          events: (input.events ?? []) as unknown as Json,
          idempotency_key: input.idempotencyKey ?? null,
          approved_scope_hash: null,
          execution_lease_until: null,
          revision: 0,
        })
        .select(COLUMNS)
        .single();
      if (error || !data) {
        if (input.idempotencyKey) {
          const lookup = await db
            .from("autopilot_missions")
            .select(COLUMNS)
            .eq("user_id", input.userId)
            .eq("idempotency_key", input.idempotencyKey)
            .maybeSingle();
          if (!lookup.error && lookup.data) return toMissionRecord(lookup.data);
        }
        throw new MissionPersistenceError("Mission could not be saved.");
      }
      return toMissionRecord(data);
    },

    async compareAndSwap(record, expectedRevision) {
      const { data, error } = await db
        .from("autopilot_missions")
        .update({
          status: record.status,
          plan: record.plan as unknown as Json,
          result: record.result,
          events: record.events as unknown as Json,
          approved_scope_hash: record.approvedScopeHash,
          execution_lease_until: record.executionLeaseUntil,
          revision: expectedRevision + 1,
        })
        .eq("id", record.id)
        .eq("user_id", record.userId)
        .eq("revision", expectedRevision)
        .select(COLUMNS)
        .maybeSingle();
      if (error) throw new MissionPersistenceError("Mission progress could not be saved.");
      return data ? toMissionRecord(data) : null;
    },
  };
}
