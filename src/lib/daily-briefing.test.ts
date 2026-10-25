import { describe, expect, it } from "vitest";
import { isTaskDueOnDate, isTaskOverdue, rankBriefingTask } from "./daily-briefing";
import type { TaskRecord } from "@/lib/task-store";

const task = (patch: Partial<TaskRecord> = {}): TaskRecord => ({
  id: "task-1",
  user_id: "user-1",
  title: "Prepare exam",
  done: false,
  priority: "med",
  due_at: "2026-10-24T23:30:00.000Z",
  reminder_id: null,
  created_at: "2026-10-20T00:00:00Z",
  updated_at: "2026-10-20T00:00:00Z",
  ...patch,
});

describe("daily briefing dates and ranking", () => {
  it("compares due dates using the viewer's local calendar day", () => {
    const date = new Date(2026, 9, 25);
    const item = task({ due_at: new Date(2026, 9, 25, 23, 59).toISOString() });
    expect(isTaskDueOnDate(item, date)).toBe(true);
    expect(isTaskDueOnDate(task({ due_at: "not-a-date" }), date)).toBe(false);
  });

  it("marks prior-day open tasks overdue but leaves completed tasks alone", () => {
    const now = new Date(2026, 9, 25, 10);
    expect(isTaskOverdue(task({ due_at: new Date(2026, 9, 24, 23).toISOString() }), now)).toBe(
      true,
    );
    expect(isTaskOverdue(task({ done: true }), now)).toBe(false);
  });

  it("ranks overdue, due-today, high-priority, and focus-matched work", () => {
    const selected = new Date(2026, 9, 25, 12);
    const overdue = task({ due_at: new Date(2026, 9, 24, 12).toISOString(), priority: "low" });
    const high = task({ due_at: new Date(2026, 9, 25, 12).toISOString(), priority: "high" });
    expect(rankBriefingTask(overdue, selected, "exam")).toBeGreaterThan(
      rankBriefingTask(high, selected, ""),
    );
  });
});
