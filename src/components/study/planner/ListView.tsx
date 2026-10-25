import { useMemo } from "react";
import { motion } from "framer-motion";
import { Clock, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { TaskContextMenu } from "./TaskContextMenu";
import type { LearningPlanTask } from "@/lib/learning/types";

interface ListViewProps {
  tasks: LearningPlanTask[];
  dailyTarget: number;
  onTaskClick: (task: LearningPlanTask) => void;
  onTaskAction?: (task: LearningPlanTask, action: string) => void;
  onStartFocus?: (task: LearningPlanTask) => void;
}

export function ListView({
  tasks,
  dailyTarget,
  onTaskClick,
  onTaskAction,
  onStartFocus,
}: ListViewProps) {
  const sorted = useMemo(
    () =>
      [...tasks].sort((a, b) => {
        if (a.status === "completed" && b.status !== "completed") return 1;
        if (a.status !== "completed" && b.status === "completed") return -1;
        return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
      }),
    [tasks],
  );

  const pending = sorted.filter((t) => t.status === "pending" || t.status === "in_progress");
  const completed = sorted.filter((t) => t.status === "completed");
  const skipped = sorted.filter((t) => t.status === "skipped");

  const taskTypeIcon = (type: string) => {
    const icons: Record<string, string> = {
      learn: "📖",
      practice: "🎯",
      review: "🔄",
      quiz: "❓",
      flashcards: "🃏",
      custom: "⚙️",
    };
    return icons[type] ?? "📋";
  };

  const priorityColor = (p: string) => {
    if (p === "high") return "text-red-400";
    if (p === "medium") return "text-amber-400";
    return "text-muted-foreground";
  };

  const renderTask = (task: LearningPlanTask, index: number, isCompleted = false) => (
    <motion.div
      key={task.id}
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2, delay: index * 0.02 }}
      className="flex items-center justify-between rounded-xl border border-border/30 bg-card/40 p-4 transition hover:border-primary/30"
    >
      <button
        onClick={() => onTaskClick(task)}
        className="flex flex-1 items-center gap-3 text-left"
      >
        <span className="text-lg">{taskTypeIcon(task.task_type)}</span>
        <div className="flex-1">
          <p className={cn("text-sm font-medium text-foreground", isCompleted && "line-through")}>
            {task.title}
          </p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="capitalize">{task.task_type}</span>
            <span>·</span>
            <Clock className="h-3 w-3" />
            <span>{task.estimated_minutes} min</span>
            <span>·</span>
            <span>{new Date(task.due_at).toLocaleDateString()}</span>
            <span>·</span>
            <span className={priorityColor(task.priority)}>{task.priority}</span>
          </div>
        </div>
      </button>
      <div className="flex items-center gap-2 ml-2">
        {onStartFocus && !isCompleted && task.status !== "skipped" && (
          <button
            type="button"
            onClick={() => onStartFocus(task)}
            className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-primary/30 px-2 text-xs text-primary hover:bg-primary/10"
            aria-label={`Start a focus timer for ${task.title}`}
          >
            <Play className="h-3.5 w-3.5" />
            Focus
          </button>
        )}
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-medium",
            task.status === "completed" && "bg-emerald-500/10 text-emerald-400",
            task.status === "skipped" && "bg-muted text-muted-foreground",
            task.status === "in_progress" && "bg-primary/10 text-primary",
            task.status === "pending" && "bg-muted/40 text-muted-foreground",
          )}
        >
          {task.status}
        </span>
        {onTaskAction && (
          <TaskContextMenu
            taskId={task.id}
            planId={task.plan_id}
            status={task.status}
            onEdit={() => onTaskClick(task)}
            onReschedule={() => onTaskAction(task, "reschedule")}
            onDurationChange={() => onTaskAction(task, "duration")}
            onPriorityChange={() => onTaskAction(task, "priority")}
            onMoveDay={() => onTaskAction(task, "reschedule")}
            onDuplicate={() => onTaskAction(task, "duplicate")}
            onSkip={() => onTaskAction(task, "skip")}
            onComplete={() => onTaskAction(task, "complete")}
            onDelete={() => onTaskAction(task, "delete")}
          />
        )}
      </div>
    </motion.div>
  );

  return (
    <div className="space-y-6">
      {pending.length > 0 && (
        <div>
          <h3 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-foreground">
            Pending ({pending.length})
          </h3>
          <div className="space-y-2">{pending.map((task, i) => renderTask(task, i))}</div>
        </div>
      )}

      {skipped.length > 0 && (
        <div>
          <h3 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Skipped ({skipped.length})
          </h3>
          <div className="space-y-2 opacity-60">
            {skipped.map((task, i) => renderTask(task, i))}
          </div>
        </div>
      )}

      {completed.length > 0 && (
        <div>
          <h3 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Completed ({completed.length})
          </h3>
          <div className="space-y-2 opacity-60">
            {completed.slice(0, 10).map((task, i) => renderTask(task, i, true))}
          </div>
        </div>
      )}
    </div>
  );
}
