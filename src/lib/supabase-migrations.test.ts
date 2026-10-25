import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

describe("production Supabase migrations", () => {
  it("repairs every user setting column selected by the application without dropping data", () => {
    const migration = readFileSync(
      resolve(migrationsDirectory, "20261018010000_repair_user_settings_preferences.sql"),
      "utf8",
    );

    for (const [column, type, defaultValue] of [
      ["default_mode", "text", "'balanced'"],
      ["voice_rate", "numeric", "1"],
      ["auto_speak", "boolean", "true"],
      ["notifications_enabled", "boolean", "true"],
    ]) {
      expect(migration).toMatch(
        new RegExp(
          `ADD COLUMN IF NOT EXISTS ${column} ${type} NOT NULL DEFAULT ${defaultValue}`,
          "i",
        ),
      );
    }
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/i);
    expect(migration).toMatch(/auth\.uid\(\)\s*=\s*user_id/i);
    expect(migration).not.toMatch(/DROP\s+(?:TABLE|COLUMN)|DISABLE ROW LEVEL SECURITY/i);
  });

  it("creates task tables with owner-scoped RLS policies", () => {
    const migration = readFileSync(
      resolve(migrationsDirectory, "20261018000000_tasks_notifications.sql"),
      "utf8",
    );

    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.tasks/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.task_notifications/i);
    expect(migration).toMatch(/ALTER TABLE public\.tasks ENABLE ROW LEVEL SECURITY/i);
    expect(migration).toMatch(/ALTER TABLE public\.task_notifications ENABLE ROW LEVEL SECURITY/i);
    expect(migration.match(/CREATE POLICY/gi)).toHaveLength(3);
    expect(migration).toMatch(
      /CREATE POLICY "Users manage their own tasks" ON public\.tasks\s+FOR ALL TO authenticated USING \(auth\.uid\(\) = user_id\)/i,
    );
    expect(migration).toMatch(
      /CREATE POLICY "Users manage their own task notifications" ON public\.task_notifications\s+FOR ALL TO authenticated USING \(auth\.uid\(\) = user_id\)/i,
    );
  });

  it("supports saving a game only after generation and keeps game rows owner-scoped", () => {
    const creation = readFileSync(
      resolve(migrationsDirectory, "20261019000000_ai_games.sql"),
      "utf8",
    );
    const lifecycle = readFileSync(
      resolve(migrationsDirectory, "20261020000000_ai_games_generation_lifecycle.sql"),
      "utf8",
    );

    expect(creation).toMatch(/user_id uuid not null references auth\.users\(id\)/i);
    expect(creation).toMatch(/ENABLE ROW LEVEL SECURITY/i);
    expect(creation).toMatch(/auth\.uid\(\) = user_id/i);
    expect(lifecycle).toMatch(/alter column spec drop not null/i);
    expect(lifecycle).toMatch(/add column if not exists status text not null default 'ready'/i);
    expect(lifecycle).toMatch(/pending.*generating.*ready.*failed/is);
  });

  it("adds memory graph columns before indexing or querying them", () => {
    const migration = readFileSync(
      resolve(migrationsDirectory, "20261024010000_lord_mind_graph.sql"),
      "utf8",
    );

    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false/i);
    expect(migration).toMatch(
      /ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public\.projects\(id\) ON DELETE CASCADE/i,
    );
    expect(migration.indexOf("ADD COLUMN IF NOT EXISTS archived")).toBeLessThan(
      migration.indexOf("WHERE archived = false"),
    );
    expect(migration.indexOf("ADD COLUMN IF NOT EXISTS project_id")).toBeLessThan(
      migration.indexOf("ON public.memories (user_id, project_id"),
    );
  });

  it("persists study focus records with unique IDs and owner-scoped access", () => {
    const migration = readFileSync(
      resolve(migrationsDirectory, "20261025000000_study_focus_sessions.sql"),
      "utf8",
    );

    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.study_focus_sessions/i);
    expect(migration).toMatch(/id UUID PRIMARY KEY/i);
    expect(migration).toMatch(/user_id UUID NOT NULL REFERENCES auth\.users\(id\)/i);
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/i);
    expect(migration).toMatch(/auth\.uid\(\)\s*=\s*user_id/i);
    expect(migration).toMatch(
      /GRANT SELECT, INSERT ON public\.study_focus_sessions TO authenticated/i,
    );
  });

  it("adds a separate personalization pause without replacing existing memory storage", () => {
    const migration = readFileSync(
      resolve(migrationsDirectory, "20261025010000_lord_memory_2.sql"),
      "utf8",
    );

    expect(migration).toMatch(
      /ADD COLUMN IF NOT EXISTS personalization_enabled BOOLEAN NOT NULL DEFAULT true/i,
    );
    expect(migration).toMatch(/ON public\.memories \(user_id, project_id, updated_at DESC\)/i);
    expect(migration).not.toMatch(/DROP\s+(?:TABLE|COLUMN)|DELETE\s+FROM/i);
  });

  it("persists bounded mission events, approval scope, and unique request IDs", () => {
    const migration = readFileSync(
      resolve(migrationsDirectory, "20261025010100_autopilot_execution_engine.sql"),
      "utf8",
    );

    expect(migration).toMatch(
      /ADD COLUMN IF NOT EXISTS events jsonb NOT NULL DEFAULT '\[\]'::jsonb/i,
    );
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS idempotency_key uuid/i);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS approved_scope_hash text/i);
    expect(migration).toMatch(/jsonb_typeof\(events\) = 'array'/i);
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS autopilot_missions_user_idempotency_idx/i,
    );
    expect(migration).not.toMatch(/DROP\s+(?:TABLE|COLUMN)|DELETE\s+FROM/i);
  });

  it("stores PhonePe orders privately and activates an entitlement atomically", () => {
    const migration = readFileSync(
      resolve(migrationsDirectory, "20261025020000_phonepe_one_time_payments.sql"),
      "utf8",
    );

    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.phonepe_orders/i);
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/i);
    expect(migration).toMatch(/REVOKE ALL ON public\.phonepe_orders FROM anon, authenticated/i);
    expect(migration).toMatch(/phonepe_orders_one_pending_per_user_idx/i);
    expect(migration).toMatch(/FOR UPDATE/i);
    expect(migration).toMatch(/INSERT INTO public\.pro_entitlements/i);
    expect(migration).toMatch(/status = 'paid'/i);
    expect(migration).not.toMatch(/DROP\s+(?:TABLE|COLUMN)|DELETE\s+FROM/i);
  });
});
