import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import { Calendar, Plus, Sparkles, TrendingUp, List, LayoutGrid, Clock } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/hooks/use-current-user";
import { completePlanTask } from "@/lib/learning/client";
import { StudyHeader } from "../StudyHeader";
import { LoadingState } from "../ui/LoadingState";
import { EmptyState } from "../ui/EmptyState";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type {
  LearningSnapshot,
  StudyView,
  LearningPlan,
  LearningPlanTask,
  PlanWithTasks,
  PlanOptimizationResult,
  AIProposedChange,
} from "../types";
import { CreatePlanModal } from "../planner/CreatePlanModal";
import { AddTaskModal } from "../planner/AddTaskModal";
import { EditPlanModal } from "../planner/EditPlanModal";
import { EditTaskModal } from "../planner/EditTaskModal";
import { CalendarView } from "../planner/CalendarView";
import { TimelineView } from "../planner/TimelineView";
import { ListView } from "../planner/ListView";
import { PlanProgress } from "../planner/PlanProgress";
import { PlanActionsMenu } from "../planner/PlanActionsMenu";
import { LordPlanAssistant } from "../planner/LordPlanAssistant";
import { PlanHealth } from "../planner/PlanHealth";
import { SmartSuggestions } from "../planner/SmartSuggestions";
import {
  createStudyPlan,
  deleteStudyPlan,
  generateAIPlan,
  listStudyPlans,
  getStudyPlan,
} from "@/lib/study-plans";
import { filterConceptsForClass } from "@/lib/learning/class";

type ViewMode = "list" | "calendar" | "timeline";

interface PlannerViewProps {
  snapshot: LearningSnapshot | undefined;
  userId: string | null;
  onNavigate: (view: StudyView) => void;
  onBack: () => void;
  refresh: () => void;
}

export function PlannerView({ snapshot, userId, onNavigate, onBack, refresh }: PlannerViewProps) {
  const { user } = useCurrentUser();
  const [plans, setPlans] = useState<LearningPlan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<PlanWithTasks | null>(null);
  const [loading, setLoading] = useState(true);
  const [planLoadError, setPlanLoadError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAddTask, setShowAddTask] = useState(false);
  const [editingPlan, setEditingPlan] = useState<LearningPlan | null>(null);
  const [editingTask, setEditingTask] = useState<LearningPlanTask | null>(null);
  const [showLordAssistant, setShowLordAssistant] = useState(false);
  const [showPlanHealth, setShowPlanHealth] = useState(false);
  const [healthResult, setHealthResult] = useState<PlanOptimizationResult | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [optimizing, setOptimizing] = useState(false);
  const selectedPlanRef = useRef(selectedPlan);
  selectedPlanRef.current = selectedPlan;

  const concepts = useMemo(
    () => filterConceptsForClass(snapshot?.concepts ?? [], snapshot?.profile?.class),
    [snapshot?.concepts, snapshot?.profile?.class],
  );

  const loadPlans = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setPlanLoadError(null);
    try {
      const allPlans = await listStudyPlans();
      setPlans(allPlans);
      const currentSelectedId = selectedPlanRef.current?.id;
      if (allPlans.length > 0 && !currentSelectedId) {
        const detail = await getStudyPlan(allPlans[0].id);
        setSelectedPlan(detail);
      } else if (allPlans.length > 0 && currentSelectedId) {
        const exists = allPlans.some((p) => p.id === currentSelectedId);
        if (!exists) {
          const detail = await getStudyPlan(allPlans[0].id);
          setSelectedPlan(detail);
        }
      }
    } catch {
      setPlanLoadError("Could not sync your study plans. Retry when your connection is available.");
      if (snapshot?.tasks && snapshot.tasks.length > 0) {
        const now = new Date().toISOString().slice(0, 10);
        const planTasks = snapshot.tasks as LearningPlanTask[];
        const plan: PlanWithTasks = {
          id: "snapshot",
          user_id: userId,
          title: "Study Plan",
          description: null,
          starts_on: planTasks[0]?.due_at?.slice(0, 10) ?? now,
          ends_on: planTasks[planTasks.length - 1]?.due_at?.slice(0, 10) ?? now,
          daily_minutes: 120,
          status: "active",
          source: "ai",
          generated_from: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          tasks: planTasks,
          progress: {
            total: planTasks.length,
            completed: planTasks.filter((t) => t.status === "completed").length,
            percent: 0,
            remainingMinutes: 0,
          },
          dailyWorkload: [],
        };
        plan.progress.percent =
          plan.progress.total > 0
            ? Math.round((plan.progress.completed / plan.progress.total) * 100)
            : 0;
        plan.progress.remainingMinutes = plan.tasks
          .filter((t) => t.status !== "completed")
          .reduce((sum, t) => sum + (t.estimated_minutes ?? 0), 0);
        setSelectedPlan(plan);
      }
    } finally {
      setLoading(false);
    }
  }, [userId, snapshot]);

  useEffect(() => {
    if (!userId) return;
    void loadPlans();
  }, [userId, snapshot, loadPlans]);

  const handleCreatePlan = async (planId: string) => {
    await loadPlans();
    const detail = await getStudyPlan(planId);
    setSelectedPlan(detail);
  };

  const handleSelectPlan = async (plan: LearningPlan) => {
    try {
      const detail = await getStudyPlan(plan.id);
      setSelectedPlan(detail);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? `Could not open this study plan: ${error.message}`
          : "Could not open this study plan. Retry when your connection is available.",
      );
    }
  };

  const handleGeneratePlan = async () => {
    if (!userId || !snapshot) return;
    setGenerating(true);
    let planIdToClean: string | null = null;
    let generatedPlanId: string | null = null;
    try {
      const conceptIds = concepts
        .map((concept) => ({
          id: concept.id,
          score: snapshot.mastery.find((item) => item.concept_id === concept.id)?.score ?? 0.3,
        }))
        .sort((left, right) => left.score - right.score)
        .slice(0, 8)
        .map((concept) => concept.id);
      if (conceptIds.length === 0) {
        toast("Add a concept before generating a study plan.");
        return;
      }
      const startDate = new Date();
      const targetDate = new Date(startDate.getTime() + 30 * 86_400_000);
      const start = startDate.toISOString().slice(0, 10);
      const target = targetDate.toISOString().slice(0, 10);
      const dailyMinutes = 30;
      const plan = await createStudyPlan({
        title: "Adaptive study plan",
        description: "A 30-day plan prioritizing topics that need the most review.",
        startDate: start,
        targetDate: target,
        dailyMinutes,
        source: "ai",
        conceptIds,
      });
      planIdToClean = plan.id;
      await generateAIPlan(plan.id, {
        conceptIds,
        weeklyMinutes: dailyMinutes * 7,
        startDate: start,
        targetDate: target,
        dailyMinutes,
        planName: plan.title,
      });
      planIdToClean = null;
      generatedPlanId = plan.id;
      await handleCreatePlan(plan.id);
      refresh();
      toast("Adaptive plan generated!");
    } catch (error) {
      let cleanupFailed = false;
      if (planIdToClean) {
        try {
          await deleteStudyPlan(planIdToClean);
        } catch {
          cleanupFailed = true;
        }
      }
      const message = error instanceof Error ? error.message : "Please try again.";
      toast.error(
        generatedPlanId
          ? `The plan was generated, but the planner could not refresh: ${message}`
          : `Could not generate the study plan: ${message}${cleanupFailed ? " An empty plan may remain in your planner." : ""}`,
      );
    } finally {
      setGenerating(false);
    }
  };

  const handleCompleteTask = async (taskId: string) => {
    if (!selectedPlan || !userId) return;
    try {
      await completePlanTask(userId, taskId);
      setSelectedPlan((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          tasks: prev.tasks.map((t) => (t.id === taskId ? { ...t, status: "completed" } : t)),
        };
      });
      await loadPlans();
    } catch {
      toast("Failed to complete task.");
    }
  };

  const handleAddTask = async () => {
    if (!selectedPlan) return;
    const detail = await getStudyPlan(selectedPlan.id);
    setSelectedPlan(detail);
  };

  const handleEditPlan = () => {
    if (selectedPlan && !selectedPlan.id.startsWith("snapshot")) {
      const plan = plans.find((p) => p.id === selectedPlan.id);
      if (plan) setEditingPlan(plan);
    }
  };

  const handlePlanSaved = async () => {
    await loadPlans();
    setEditingPlan(null);
  };

  const handleArchivePlan = async () => {
    if (!selectedPlan) return;
    try {
      const { archiveStudyPlan } = await import("@/lib/study-plans");
      await archiveStudyPlan(selectedPlan.id);
      await loadPlans();
      setEditingPlan(null);
      toast("Plan archived.");
    } catch {
      toast("Failed to archive plan.");
    }
  };

  const handlePausePlan = async () => {
    if (!selectedPlan) return;
    try {
      const { pauseStudyPlan } = await import("@/lib/study-plans");
      await pauseStudyPlan(selectedPlan.id);
      await loadPlans();
      setEditingPlan(null);
      toast("Plan paused.");
    } catch {
      toast("Failed to pause plan.");
    }
  };

  const handleResumePlan = async () => {
    if (!selectedPlan) return;
    try {
      const { updateStudyPlan } = await import("@/lib/study-plans");
      await updateStudyPlan(selectedPlan.id, { status: "active" });
      await loadPlans();
      setEditingPlan(null);
      toast("Plan resumed.");
    } catch {
      toast("Failed to resume plan.");
    }
  };

  const handleDuplicatePlan = async () => {
    if (!selectedPlan) return;
    try {
      const { duplicateStudyPlan } = await import("@/lib/study-plans");
      const newPlan = await duplicateStudyPlan(selectedPlan.id);
      await loadPlans();
      setSelectedPlan(await getStudyPlan(newPlan.id));
      setEditingPlan(null);
      toast("Plan duplicated.");
    } catch {
      toast("Failed to duplicate plan.");
    }
  };

  const handleDeletePlan = async () => {
    if (!selectedPlan) return;
    try {
      const { deleteStudyPlan } = await import("@/lib/study-plans");
      await deleteStudyPlan(selectedPlan.id);
      setSelectedPlan(null);
      await loadPlans();
      setEditingPlan(null);
      toast("Plan deleted.");
    } catch {
      toast("Failed to delete plan.");
    }
  };

  const handleTaskSaved = async () => {
    if (!selectedPlan) return;
    const detail = await getStudyPlan(selectedPlan.id);
    setSelectedPlan(detail);
    setEditingTask(null);
  };

  const handleTaskContextAction = async (task: LearningPlanTask, action: string) => {
    if (!selectedPlan) return;
    if (action === "reschedule" || action === "duration") {
      setEditingTask(task);
      return;
    }
    try {
      const studyPlans = await import("@/lib/study-plans");
      switch (action) {
        case "priority": {
          const priorities = ["low", "medium", "high"] as const;
          const currentIndex = priorities.indexOf(task.priority as (typeof priorities)[number]);
          const nextPriority = priorities[(currentIndex + 1) % priorities.length];
          await studyPlans.updatePlanTask(selectedPlan.id, task.id, {
            priority: nextPriority,
          });
          await reloadSelectedPlan();
          toast(`Priority set to ${nextPriority}.`);
          break;
        }
        case "duplicate": {
          await studyPlans.addPlanTask(selectedPlan.id, {
            title: `${task.title} (copy)`,
            description: task.description ?? undefined,
            conceptId: task.concept_id ?? undefined,
            taskType: task.task_type as LearningPlanTask["task_type"],
            scheduledDate: new Date(task.due_at).toISOString().slice(0, 10),
            estimatedMinutes: task.estimated_minutes,
            priority: task.priority as LearningPlanTask["priority"],
            notes: task.notes ?? undefined,
          });
          await reloadSelectedPlan();
          toast("Task duplicated.");
          break;
        }
        case "complete":
          await handleCompleteTask(task.id);
          break;
        case "skip": {
          await studyPlans.skipPlanTask(selectedPlan.id, task.id);
          await reloadSelectedPlan();
          toast("Task skipped.");
          break;
        }
        case "delete": {
          await studyPlans.deletePlanTask(selectedPlan.id, task.id);
          await reloadSelectedPlan();
          toast("Task deleted.");
          break;
        }
      }
    } catch {
      toast("Failed to update task. Please try again.");
    }
  };

  const reloadSelectedPlan = async () => {
    if (!selectedPlan) return;
    const detail = await getStudyPlan(selectedPlan.id);
    setSelectedPlan(detail);
  };

  const handleLordApplyChanges = async (changes: AIProposedChange[]) => {
    if (!selectedPlan) return;
    try {
      const studyPlans = await import("@/lib/study-plans");
      for (const change of changes) {
        if (change.action === "reschedule" && change.taskId && change.to) {
          await studyPlans.reschedulePlanTask(selectedPlan.id, change.taskId, change.to as string);
        } else if (change.action === "update" && change.taskId && change.field) {
          await studyPlans.updatePlanTask(selectedPlan.id, change.taskId, {
            [change.field]: change.to,
          });
        } else if (change.action === "delete" && change.taskId) {
          await studyPlans.deletePlanTask(selectedPlan.id, change.taskId);
        } else if (change.action === "duplicate" && change.taskId) {
          const task = selectedPlan.tasks.find((t) => t.id === change.taskId);
          if (task) {
            await studyPlans.addPlanTask(selectedPlan.id, {
              title: `${task.title} (copy)`,
              description: task.description ?? undefined,
              conceptId: task.concept_id ?? undefined,
              taskType: task.task_type,
              scheduledDate: new Date(task.due_at).toISOString().slice(0, 10),
              estimatedMinutes: task.estimated_minutes,
              priority: task.priority,
              notes: task.notes ?? undefined,
            });
          }
        }
      }
      const detail = await getStudyPlan(selectedPlan.id);
      setSelectedPlan(detail);
      toast("Changes applied successfully.");
    } catch {
      toast("Failed to apply some changes.");
    }
  };

  const handleLordOptimize = async (): Promise<PlanOptimizationResult> => {
    if (!selectedPlan) throw new Error("No plan selected");
    const { optimizePlan } = await import("@/lib/study-plans");
    return optimizePlan(selectedPlan.id);
  };

  const handleLordSuggest = async (message: string) => {
    if (!selectedPlan) throw new Error("No plan selected");
    const { suggestPlanChanges } = await import("@/lib/study-plans");
    return suggestPlanChanges(selectedPlan.id, message);
  };

  const handleOptimize = async () => {
    setShowPlanHealth(true);
    setOptimizing(true);
    setHealthResult(null);
    try {
      const result = await handleLordOptimize();
      setHealthResult(result);
    } catch {
      setHealthResult({
        summary: "Could not analyze plan.",
        health: {
          workload: "optimal",
          coverage: "good",
          revision: "fair",
          weakTopics: 0,
          deadline: "on_track",
        },
        changes: [],
        recommendations: ["Try again later."],
        smartSuggestions: [],
      });
    } finally {
      setOptimizing(false);
    }
  };

  const handleRebalance = async () => {
    await handleOptimize();
    await loadPlans();
    if (selectedPlan) {
      const detail = await getStudyPlan(selectedPlan.id);
      setSelectedPlan(detail);
    }
  };

  const dailyTarget = selectedPlan?.daily_minutes ?? 120;
  const tasks = selectedPlan?.tasks ?? [];
  const pendingTasks = tasks.filter((t) => t.status === "pending" || t.status === "in_progress");
  const completedTasks = tasks.filter((t) => t.status === "completed");

  if (!snapshot || !user) {
    return (
      <div className="p-6">
        <StudyHeader
          view="planner"
          title="Study Planner"
          onBack={onBack}
          showBack
          icon={<Calendar className="h-6 w-6 text-primary" />}
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6">
        <StudyHeader
          view="planner"
          title="Study Planner"
          onBack={onBack}
          showBack
          icon={<Calendar className="h-6 w-6 text-primary" />}
        />
        <LoadingState message="Loading your study plans…" />
      </div>
    );
  }

  const noPlans = plans.length === 0 && !selectedPlan;

  return (
    <div className="p-6">
      <StudyHeader
        view="planner"
        title="Study Planner"
        subtitle={selectedPlan ? selectedPlan.title : "Your adaptive learning schedule"}
        onBack={onBack}
        showBack
        icon={<Calendar className="h-6 w-6 text-primary" />}
        action={
          <div className="flex items-center gap-2">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-border/40 bg-card/40 px-4 py-2 text-sm font-semibold text-foreground transition hover:border-primary/40 hover:bg-primary/5"
            >
              <Plus className="h-4 w-4" />
              Create Plan
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleGeneratePlan}
              disabled={generating}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold",
                generating
                  ? "cursor-not-allowed bg-muted/30 text-muted-foreground"
                  : "bg-primary text-primary-foreground shadow hover:bg-primary/90",
              )}
            >
              {generating ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
                  Generating…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Generate Adaptive Plan
                </>
              )}
            </motion.button>
          </div>
        }
      />

      {planLoadError && (
        <div
          role="status"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100"
        >
          <span>{planLoadError}</span>
          <button
            type="button"
            onClick={() => void loadPlans()}
            className="rounded-md border border-amber-200/30 px-3 py-1.5 font-medium hover:bg-amber-200/10"
          >
            Retry
          </button>
        </div>
      )}

      {noPlans && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-8">
          <EmptyState
            icon={<Calendar className="h-8 w-8" />}
            title="No study plan yet"
            description="Create a plan manually or ask LORD to generate an adaptive plan based on your mastery data."
            action={
              <div className="flex gap-3">
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="rounded-lg border border-border/40 bg-card/40 px-4 py-2 text-sm font-semibold text-foreground transition hover:border-primary/40 hover:bg-primary/5"
                >
                  + Create Plan
                </button>
                <button
                  onClick={handleGeneratePlan}
                  disabled={generating}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
                >
                  {generating ? "Generating…" : "Generate Adaptive Plan"}
                </button>
              </div>
            }
          />
        </motion.div>
      )}

      {selectedPlan && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="mt-6 space-y-4"
        >
          {selectedPlan.progress && <PlanProgress plan={selectedPlan} tasks={tasks} />}

          <SmartSuggestions plan={selectedPlan} tasks={tasks} onRebalance={handleRebalance} />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="font-display text-lg font-semibold text-foreground">
                {selectedPlan.title}
                <span className="ml-2 inline-flex rounded-full bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground">
                  {selectedPlan.status}
                </span>
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex rounded-lg border border-border/30 bg-card/30 p-0.5">
                {[
                  { mode: "list" as ViewMode, icon: List, label: "List" },
                  { mode: "calendar" as ViewMode, icon: LayoutGrid, label: "Calendar" },
                  { mode: "timeline" as ViewMode, icon: Clock, label: "Timeline" },
                ].map(({ mode, icon: Icon, label }) => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition",
                      viewMode === mode
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                ))}
              </div>
              <PlanActionsMenu
                plan={selectedPlan}
                onEdit={handleEditPlan}
                onArchive={handleArchivePlan}
                onPause={handlePausePlan}
                onResume={handleResumePlan}
                onDuplicate={handleDuplicatePlan}
                onDelete={handleDeletePlan}
                onAskLord={() => setShowLordAssistant(true)}
                onOptimize={handleOptimize}
              />
            </div>
          </div>

          {plans.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-2">
              {plans.map((plan) => (
                <button
                  key={plan.id}
                  onClick={() => handleSelectPlan(plan)}
                  className={cn(
                    "shrink-0 rounded-xl border px-4 py-2 text-left transition",
                    selectedPlan.id === plan.id
                      ? "border-primary/40 bg-primary/5"
                      : "border-border/30 bg-card/30 hover:border-primary/20",
                  )}
                >
                  <p className="text-sm font-medium text-foreground">{plan.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {plan.status} · {new Date(plan.ends_on).toLocaleDateString()}
                  </p>
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {pendingTasks.length} pending · {completedTasks.length} completed · {tasks.length}{" "}
              total
            </p>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setShowAddTask(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-border/40 bg-card/40 px-4 py-2 text-sm font-semibold text-foreground transition hover:border-primary/40 hover:bg-primary/5"
            >
              <Plus className="h-4 w-4" />
              Add Task
            </motion.button>
          </div>

          {viewMode === "list" && (
            <ListView
              tasks={tasks}
              dailyTarget={dailyTarget}
              onTaskClick={(task) => setEditingTask(task)}
              onTaskAction={(task, action) => void handleTaskContextAction(task, action)}
              onStartFocus={(task) => {
                const plannedSubject = snapshot?.concepts.find(
                  (concept) => concept.id === task.concept_id,
                )?.subject;
                window.dispatchEvent(
                  new CustomEvent("lord:open-focus-session", {
                    detail: {
                      subject: plannedSubject ?? "",
                      label: task.title,
                      minutes: task.estimated_minutes,
                    },
                  }),
                );
              }}
            />
          )}
          {viewMode === "calendar" && (
            <CalendarView
              tasks={tasks}
              dailyTarget={dailyTarget}
              onTaskClick={(task) => setEditingTask(task)}
              onDateClick={(date) => {
                const dayTasks = tasks.filter(
                  (t) => new Date(t.due_at).toISOString().slice(0, 10) === date,
                );
                if (dayTasks.length > 0) setEditingTask(dayTasks[0]);
              }}
            />
          )}
          {viewMode === "timeline" && (
            <TimelineView
              tasks={tasks}
              dailyTarget={dailyTarget}
              onTaskClick={(task) => setEditingTask(task)}
            />
          )}
        </motion.div>
      )}

      <CreatePlanModal
        open={showCreateModal}
        onOpenChange={setShowCreateModal}
        userId={userId}
        concepts={concepts}
        onCreated={handleCreatePlan}
        onBrowseConcepts={() => onNavigate("concepts")}
      />

      {selectedPlan && (
        <AddTaskModal
          open={showAddTask}
          onOpenChange={setShowAddTask}
          planId={selectedPlan.id}
          userId={userId}
          concepts={concepts}
          onAdded={handleAddTask}
        />
      )}

      {editingPlan && (
        <EditPlanModal
          open={!!editingPlan}
          onOpenChange={(open) => !open && setEditingPlan(null)}
          plan={editingPlan}
          onSaved={handlePlanSaved}
          onArchive={handleArchivePlan}
          onPause={handlePausePlan}
          onResume={handleResumePlan}
          onDuplicate={handleDuplicatePlan}
          onDelete={handleDeletePlan}
        />
      )}

      {editingTask && selectedPlan && (
        <EditTaskModal
          task={editingTask}
          open={!!editingTask}
          onOpenChange={(open) => !open && setEditingTask(null)}
          concepts={concepts.map((c) => ({ id: c.id, title: c.title }))}
          onSaved={handleTaskSaved}
          onComplete={async () => {
            await handleCompleteTask(editingTask.id);
            setEditingTask(null);
          }}
          onSkip={async () => {
            const { skipPlanTask } = await import("@/lib/study-plans");
            await skipPlanTask(selectedPlan.id, editingTask.id);
            await handleTaskSaved();
            toast("Task skipped.");
          }}
          onDelete={async () => {
            const { deletePlanTask } = await import("@/lib/study-plans");
            await deletePlanTask(selectedPlan.id, editingTask.id);
            await handleTaskSaved();
            toast("Task deleted.");
          }}
        />
      )}

      {selectedPlan && (
        <LordPlanAssistant
          open={showLordAssistant}
          onOpenChange={setShowLordAssistant}
          planTitle={selectedPlan.title}
          onApplyChanges={handleLordApplyChanges}
          onOptimize={handleLordOptimize}
          onSuggest={handleLordSuggest}
        />
      )}

      {selectedPlan && (
        <Dialog open={showPlanHealth} onOpenChange={setShowPlanHealth}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="font-display text-xl flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary" />
                Plan Optimization
              </DialogTitle>
            </DialogHeader>
            {optimizing ? (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <p className="mt-3 text-sm text-muted-foreground">Analyzing your plan…</p>
              </div>
            ) : healthResult ? (
              <PlanHealth result={healthResult} tasks={tasks} />
            ) : null}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
