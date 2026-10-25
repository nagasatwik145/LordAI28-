import { isSameDay, startOfDay } from "date-fns";
import type { TaskRecord } from "@/lib/task-store";

export function isTaskDueOnDate(task: TaskRecord, date: Date): boolean {
  if (!task.due_at) return false;
  const due = new Date(task.due_at);
  return Number.isFinite(due.getTime()) && isSameDay(due, date);
}

export function isTaskOverdue(task: TaskRecord, now: Date): boolean {
  if (!task.due_at || task.done) return false;
  const due = new Date(task.due_at);
  return Number.isFinite(due.getTime()) && due < startOfDay(now);
}

export function rankBriefingTask(task: TaskRecord, date: Date, focus: string): number {
  const overdue = isTaskOverdue(task, date);
  const dueToday = isTaskDueOnDate(task, date);
  const focusMatch =
    !!focus.trim() && task.title.toLowerCase().includes(focus.trim().toLowerCase());
  return (
    (overdue ? 100 : 0) +
    (dueToday ? 40 : 0) +
    (task.priority === "high" ? 30 : task.priority === "med" ? 15 : 0) +
    (focusMatch ? 20 : 0)
  );
}
