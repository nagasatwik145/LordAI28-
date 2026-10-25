import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  Target,
  Flame,
  Trophy,
  Calendar,
  Sparkles,
  GraduationCap,
  Brain,
  FileQuestion,
  AlertTriangle,
  Lightbulb,
  Rocket,
  Zap,
} from "lucide-react";
import { selectNextConcept } from "@/lib/learning/mastery";
import { getConceptClass, classToGradeBand } from "@/lib/learning/class";
import { generateDailyMissions, generateRecommendations } from "@/lib/learning/brain";
import { StatCard } from "../ui/StatCard";
import { QuickActionTile } from "../ui/QuickActionTile";
import { ConceptCard } from "../ui/ConceptCard";
import { StudyHeader } from "../StudyHeader";
import { ChangeClassDialog } from "./ChangeClassDialog";
import type { LearningSnapshot, StudyView } from "../types";

interface DashboardViewProps {
  snapshot: LearningSnapshot | undefined;
  userId: string | null;
  onNavigate: (view: StudyView) => void;
  onStartPractice: (conceptId?: string) => void;
  onStartTutor: (conceptId?: string) => void;
  onConceptClick: (conceptId: string) => void;
  refresh: () => void;
}

export function DashboardView({
  snapshot,
  userId,
  onNavigate,
  onStartPractice,
  onStartTutor,
  onConceptClick,
  refresh,
}: DashboardViewProps) {
  const { concepts, mastery, tasks, sessions, attempts, profile } = snapshot ?? {};

  const selectedClass = useMemo(() => {
    const cls = profile?.class;
    if (!cls) return null;
    const n = Number.parseInt(cls, 10);
    return Number.isNaN(n) ? null : n;
  }, [profile?.class]);

  const studentGradeBand = useMemo(
    () => classToGradeBand(profile?.class ?? null),
    [profile?.class],
  );

  const curriculumConcepts = useMemo(() => {
    const list = concepts ?? [];
    if (!selectedClass) return list;
    return list.filter((c) => {
      if (c.is_custom) return true;
      const conceptClass = getConceptClass(c);
      if (conceptClass !== null) return conceptClass === selectedClass;
      return c.grade_band === studentGradeBand;
    });
  }, [concepts, selectedClass, studentGradeBand]);

  const masteryMap = useMemo(
    () => new Map((mastery ?? []).map((m) => [m.concept_id, m])),
    [mastery],
  );
  const nextConcept = selectNextConcept(curriculumConcepts, mastery ?? []);

  const masteredCount = curriculumConcepts.filter((concept) => {
    return (masteryMap.get(concept.id)?.score ?? 0) >= 0.8;
  }).length;
  const totalMastery = curriculumConcepts.length;
  const masteryPercent = totalMastery > 0 ? Math.round((masteredCount / totalMastery) * 100) : 0;

  const brainInput = useMemo(
    () => ({
      snapshot: snapshot ?? ({} as LearningSnapshot),
      availableMinutes: 120,
      energyLevel: "medium" as const,
    }),
    [snapshot],
  );

  const dailyMissions = useMemo(() => generateDailyMissions(brainInput), [brainInput]);
  const recommendations = useMemo(() => generateRecommendations(brainInput), [brainInput]);

  if (!snapshot) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">No learning data available yet.</p>
      </div>
    );
  }

  const masteredConcepts = curriculumConcepts.filter((c) => {
    const m = masteryMap.get(c.id);
    return m && m.score >= 0.8;
  });

  const learningConcepts = curriculumConcepts.filter((c) => {
    const m = masteryMap.get(c.id);
    return m && m.score >= 0.6 && m.score < 0.8;
  });

  const notStartedConcepts = curriculumConcepts.filter((c) => {
    const m = masteryMap.get(c.id);
    return !m || m.score < 0.35;
  });

  const today = new Date().toDateString();
  const todaysAttempts = (attempts ?? []).filter(
    (a) => new Date(a.created_at).toDateString() === today,
  );
  const dailyGoal = Math.min(100, Math.round((todaysAttempts.length / 3) * 100));

  let streak = 0;
  const cursor = new Date();
  const activeDays = new Set(
    [...(sessions ?? []), ...(attempts ?? [])].map((item) =>
      new Date(item.created_at).toDateString(),
    ),
  );
  if (!activeDays.has(cursor.toDateString())) cursor.setDate(cursor.getDate() - 1);
  while (activeDays.has(cursor.toDateString())) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  const xp = (mastery ?? []).reduce((sum, m) => sum + (m.evidence_count ?? 0) * 25, 0);

  const upcomingTasks = (tasks ?? []).slice(0, 5);

  const quickActions = [
    {
      icon: <Target className="h-5 w-5" />,
      title: nextConcept ? "Adaptive Practice" : "Browse Concepts",
      subtitle: nextConcept ? "AI-generated questions" : "Choose a topic to practice",
      onClick: () => (nextConcept ? onStartPractice(nextConcept.id) : onNavigate("concepts")),
    },
    {
      icon: <GraduationCap className="h-5 w-5" />,
      title: "AI Tutor Session",
      subtitle: "Ask LORD anything",
      onClick: () => onStartTutor(nextConcept?.id),
    },
    {
      icon: <Brain className="h-5 w-5" />,
      title: "Flashcard Study",
      subtitle: "Spaced repetition",
      onClick: () => onNavigate("flashcards"),
    },
    {
      icon: <FileQuestion className="h-5 w-5" />,
      title: "Take a Test",
      subtitle: "Mastery checkpoint",
      onClick: () => onNavigate("exams"),
    },
  ];

  const totalConcepts = curriculumConcepts.length;
  const overallMasteryPercent =
    totalConcepts > 0 ? Math.round((masteredCount / totalConcepts) * 100) : 0;

  const missionPriorityIcon = (priority: string) => {
    switch (priority) {
      case "high":
        return <AlertTriangle className="h-4 w-4 text-red-500" />;
      case "medium":
        return <Lightbulb className="h-4 w-4 text-yellow-500" />;
      default:
        return <Zap className="h-4 w-4 text-blue-500" />;
    }
  };

  const missionTypeIcon = (type: string) => {
    switch (type) {
      case "tutor":
        return <GraduationCap className="h-4 w-4" />;
      case "practice":
        return <Target className="h-4 w-4" />;
      case "review":
        return <Brain className="h-4 w-4" />;
      case "quiz":
        return <FileQuestion className="h-4 w-4" />;
      case "flashcards":
        return <Brain className="h-4 w-4" />;
      default:
        return <Rocket className="h-4 w-4" />;
    }
  };

  const handleMissionClick = (mission: (typeof dailyMissions)[0]) => {
    const firstTask = mission.tasks[0];
    if (!firstTask) return;
    switch (firstTask.type) {
      case "tutor":
        onStartTutor(firstTask.conceptId ?? undefined);
        break;
      case "practice":
      case "learn":
        onStartPractice(firstTask.conceptId ?? undefined);
        break;
      case "quiz":
        onNavigate("exams");
        break;
      case "flashcards":
      case "review":
        onNavigate("flashcards");
        break;
      default:
        onStartTutor();
    }
  };

  return (
    <div className="p-6">
      <StudyHeader
        view="dashboard"
        title="Learning Dashboard"
        subtitle="Your personalized adaptive learning hub"
        icon={<GraduationCap className="h-6 w-6 text-primary" />}
        masteryPercent={overallMasteryPercent}
        totalConcepts={totalConcepts}
        masteredCount={masteredCount}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event("lord:open-focus-session"))}
              className="min-h-10 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Start studying
            </button>
            <ChangeClassDialog
              userId={userId}
              currentClass={profile?.class ?? null}
              onSaved={refresh}
            />
          </div>
        }
      />

      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <StatCard
          icon={<Flame className="h-5 w-5" />}
          label="Study Streak"
          value={`${streak} day${streak !== 1 ? "s" : ""}`}
          detail={streak ? "Keep it going!" : "Start a session today"}
          accent="amber"
          delay={0}
        />
        <StatCard
          icon={<Trophy className="h-5 w-5" />}
          label="Mastery"
          value={`${masteryPercent}%`}
          detail={`${masteredCount} of ${totalMastery} concepts mastered`}
          accent="emerald"
          delay={1}
        />
        <StatCard
          icon={<Target className="h-5 w-5" />}
          label="Today's Goal"
          value={`${dailyGoal}%`}
          detail={`${todaysAttempts.length}/3 practice attempts`}
          accent="cyan"
          delay={2}
        />
        <StatCard
          icon={<Sparkles className="h-5 w-5" />}
          label="Learning XP"
          value={String(xp)}
          detail="Earned from practice and mastery"
          accent="violet"
          delay={3}
        />
      </motion.section>

      {dailyMissions.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.15 }}
          className="mb-8"
        >
          <div className="mb-4 flex items-center gap-2">
            <Rocket className="h-5 w-5 text-primary" />
            <h3 className="font-display text-lg font-semibold text-foreground">
              Today's AI Mission
            </h3>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {dailyMissions.map((mission, i) => (
              <motion.button
                key={mission.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i * 0.05 }}
                onClick={() => handleMissionClick(mission)}
                className="flex flex-col rounded-xl border border-border/60 bg-card p-5 text-left hover:border-primary/40 hover:shadow-md transition-all group"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {missionPriorityIcon(mission.priority)}
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      {mission.priority} priority
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {mission.estimatedMinutes} min
                  </span>
                </div>
                <h4 className="font-display text-base font-semibold text-foreground group-hover:text-primary transition-colors">
                  {mission.title}
                </h4>
                <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                  {mission.description}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {mission.tasks.map((task, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1 rounded-md bg-muted/50 px-2 py-1 text-xs text-foreground"
                    >
                      {missionTypeIcon(task.type)}
                      {task.conceptTitle}
                    </span>
                  ))}
                </div>
              </motion.button>
            ))}
          </div>
        </motion.section>
      )}

      {recommendations.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
          className="mb-8"
        >
          <div className="mb-4 flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-primary" />
            <h3 className="font-display text-lg font-semibold text-foreground">
              Smart Recommendations
            </h3>
          </div>
          <div className="space-y-3">
            {recommendations.map((rec, i) => (
              <motion.button
                key={rec.id}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: i * 0.05 }}
                onClick={() => {
                  if (rec.conceptId) {
                    onStartTutor(rec.conceptId);
                  } else if (rec.action.type === "open_dashboard") {
                    onNavigate("dashboard");
                  } else if (rec.action.type === "start_tutor") {
                    onStartTutor((rec.action.payload.conceptId as string) ?? undefined);
                  } else if (rec.action.type === "start_practice") {
                    onStartPractice((rec.action.payload.conceptId as string) ?? undefined);
                  } else if (rec.action.type === "start_learning") {
                    onStartPractice((rec.action.payload.conceptId as string) ?? undefined);
                  }
                }}
                className="flex w-full items-start gap-3 rounded-xl border border-border/60 bg-card p-4 text-left hover:border-primary/40 hover:shadow-sm transition-all"
              >
                <div
                  className={`mt-0.5 rounded-full p-1.5 ${
                    rec.type === "forgotten"
                      ? "bg-red-500/10 text-red-500"
                      : rec.type === "weak_topic"
                        ? "bg-orange-500/10 text-orange-500"
                        : rec.type === "prerequisite"
                          ? "bg-green-500/10 text-green-500"
                          : rec.type === "habit"
                            ? "bg-blue-500/10 text-blue-500"
                            : "bg-muted text-muted-foreground"
                  }`}
                >
                  {rec.type === "forgotten" && <Brain className="h-4 w-4" />}
                  {rec.type === "weak_topic" && <AlertTriangle className="h-4 w-4" />}
                  {rec.type === "prerequisite" && <Rocket className="h-4 w-4" />}
                  {rec.type === "habit" && <Sparkles className="h-4 w-4" />}
                  {!["forgotten", "weak_topic", "prerequisite", "habit"].includes(rec.type) && (
                    <Lightbulb className="h-4 w-4" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{rec.message}</p>
                  {rec.conceptTitle && (
                    <p className="text-xs text-muted-foreground mt-0.5">{rec.conceptTitle}</p>
                  )}
                </div>
                <div
                  className={`text-xs font-medium px-2 py-1 rounded-full ${
                    rec.urgency >= 8
                      ? "bg-red-500/10 text-red-600"
                      : rec.urgency >= 5
                        ? "bg-yellow-500/10 text-yellow-600"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {rec.urgency >= 8 ? "Urgent" : rec.urgency >= 5 ? "Important" : "Nice"}
                </div>
              </motion.button>
            ))}
          </div>
        </motion.section>
      )}

      {nextConcept && (
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.25 }}
          className="mb-8 rounded-xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card p-6"
        >
          <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
            <Target className="h-3.5 w-3.5" />
            Next Focus
          </div>
          <h2 className="font-display text-2xl font-bold text-foreground">{nextConcept.title}</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{nextConcept.description}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => onStartPractice(nextConcept.id)}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow transition hover:bg-primary/90"
            >
              <Target className="h-4 w-4" />
              Start Practice
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => onStartTutor(nextConcept.id)}
              className="inline-flex items-center gap-2 rounded-lg border border-border/40 px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/20"
            >
              <GraduationCap className="h-4 w-4" />
              Ask LORD
            </motion.button>
          </div>
        </motion.section>
      )}

      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.3 }}
        className="mb-8"
      >
        <h3 className="mb-4 font-display text-lg font-semibold text-foreground">Quick Actions</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {quickActions.map((action, i) => (
            <QuickActionTile
              key={action.title}
              icon={action.icon}
              title={action.title}
              subtitle={action.subtitle}
              onClick={action.onClick}
              delay={i}
            />
          ))}
        </div>
      </motion.section>

      {upcomingTasks.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.4 }}
          className="mb-8"
        >
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-display text-lg font-semibold text-foreground">Upcoming Tasks</h3>
            <button
              onClick={() => onNavigate("planner")}
              className="text-xs text-primary hover:underline"
            >
              View all
            </button>
          </div>
          <div className="space-y-2">
            {upcomingTasks.map((task) => (
              <div
                key={task.id}
                className="flex items-center justify-between rounded-lg border border-border/40 bg-card/50 px-3 py-2.5"
              >
                <div className="flex items-center gap-2">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-sm font-medium">{task.title}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {new Date(task.due_at).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </motion.section>
      )}

      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.5 }}
        className="mb-8"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold text-foreground">Your Concepts</h3>
          <button
            onClick={() => onNavigate("concepts")}
            className="text-xs text-primary hover:underline"
          >
            View all
          </button>
        </div>

        {curriculumConcepts.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {curriculumConcepts.slice(0, 8).map((concept, i) => (
              <ConceptCard
                key={concept.id}
                concept={concept}
                masteryScore={masteryMap.get(concept.id)?.score}
                onClick={() => onConceptClick(concept.id)}
                compact
                delay={i}
              />
            ))}
          </div>
        ) : (
          <div className="py-8 text-center text-muted-foreground">
            No concepts available yet. Start practicing to build your learning path.
          </div>
        )}
      </motion.section>

      {masteredCount > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.6 }}
          className="mb-8"
        >
          <h3 className="mb-4 font-display text-lg font-semibold text-foreground">
            Mastered Concepts
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {masteredConcepts.slice(0, 6).map((concept, i) => (
              <ConceptCard
                key={concept.id}
                concept={concept}
                masteryScore={masteryMap.get(concept.id)?.score}
                onClick={() => onConceptClick(concept.id)}
                compact
                delay={i}
              />
            ))}
          </div>
        </motion.section>
      )}
    </div>
  );
}
