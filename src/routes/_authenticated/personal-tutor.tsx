import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  LockKeyhole,
  Brain,
  BookOpen,
  Sparkles,
  ArrowLeft,
  Flag,
  CheckCircle2,
} from "lucide-react";
import { AppShell } from "@/components/lord/AppShell";
import { authenticatedFetch } from "@/lib/authenticated-fetch";

type Question = {
  id: string;
  subject: string;
  topic: string;
  prompt: string;
  choices: string[];
  difficulty: number;
};
type Result = { correct: boolean; hint: string | null; explanation: string };
type ApiState = {
  attempts: Array<Question & { attempted_at: string; is_correct?: boolean }>;
  preferences: { subject: string | null; topic: string | null; weekly_goal_minutes: number } | null;
  activityCount: number;
  accuracy: number | null;
};
async function tutorRequest<T>(body: Record<string, unknown>): Promise<T> {
  const response = await authenticatedFetch("/api/personal-tutor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Personal Tutor request failed.");
  return result as T;
}

export const Route = createFileRoute("/_authenticated/personal-tutor")({
  component: PersonalTutor,
});
function PersonalTutor() {
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState("");
  const [topic, setTopic] = useState("");
  const [question, setQuestion] = useState<Question | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [weeklyGoal, setWeeklyGoal] = useState(120);
  const query = useQuery({
    queryKey: ["personal-tutor-dashboard"],
    queryFn: () => tutorRequest<ApiState>({ action: "dashboard" }),
    retry: false,
  });
  const denied =
    query.error instanceof Error && query.error.message.includes("requires an active LORD Pro");

  useEffect(() => {
    if (query.data?.preferences) {
      setSubject(query.data.preferences.subject ?? "");
      setTopic(query.data.preferences.topic ?? "");
      setWeeklyGoal(query.data.preferences.weekly_goal_minutes);
    }
  }, [query.data?.preferences]);

  async function startPractice() {
    setBusy(true);
    setResult(null);
    setSelected(null);
    try {
      await tutorRequest({
        action: "preference",
        subject,
        topic,
        weeklyGoalMinutes: weeklyGoal,
      });
      const data = await tutorRequest<{ question: Question }>({
        action: "generate",
        subject,
        topic,
      });
      setQuestion(data.question);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not create practice.");
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (!question || selected === null) return;
    setBusy(true);
    try {
      setResult(
        await tutorRequest<Result>({
          action: "answer",
          questionId: question.id,
          selectedIndex: selected,
        }),
      );
      await queryClient.invalidateQueries({ queryKey: ["personal-tutor-dashboard"] });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not submit answer.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6" aria-busy={query.isLoading}>
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-primary">LORD Pro</p>
            <h1 className="mt-1 text-3xl font-bold">Personal Tutor</h1>
            <p className="mt-1 text-muted-foreground">
              Practice at your pace with questions that adapt to your results.
            </p>
          </div>
          <a className="rounded-lg border px-4 py-2 text-sm hover:bg-muted" href="/study">
            Back to Study
          </a>
        </header>
        {query.isLoading && (
          <p role="status" className="rounded-xl border p-5">
            Checking your Pro access…
          </p>
        )}
        {denied && (
          <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6">
            <LockKeyhole className="mb-3 h-6 w-6 text-amber-500" />
            <h2 className="text-xl font-semibold">Personal Tutor is a Pro feature</h2>
            <p className="mt-2 text-muted-foreground">
              Upgrade to LORD Pro for adaptive practice, saved explanations, and progress that syncs
              across your devices.
            </p>
            <a
              className="mt-4 inline-flex rounded-lg bg-primary px-4 py-2 text-primary-foreground"
              href="/upgrade"
            >
              Explore LORD Pro
            </a>
          </section>
        )}
        {query.error && !denied && (
          <p role="alert" className="rounded-xl border border-destructive/40 p-4 text-destructive">
            {query.error.message}
          </p>
        )}
        {query.data && (
          <>
            <section className="grid gap-3 sm:grid-cols-3">
              <Stat
                icon={<Brain />}
                label="Questions attempted"
                value={String(query.data.activityCount)}
              />
              <Stat
                icon={<CheckCircle2 />}
                label="Recorded accuracy"
                value={query.data.accuracy === null ? "No results yet" : `${query.data.accuracy}%`}
              />
              <Stat icon={<BookOpen />} label="Weekly goal" value={`${weeklyGoal} min`} />
            </section>
            {!question ? (
              <section className="grid gap-5 rounded-2xl border bg-card p-5 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <label className="text-sm font-medium">
                  Subject
                  <input
                    className="mt-2 block w-full rounded-lg border bg-background p-3"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="e.g. Biology"
                    maxLength={80}
                  />
                </label>
                <label className="text-sm font-medium">
                  Topic
                  <input
                    className="mt-2 block w-full rounded-lg border bg-background p-3"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="e.g. Cell division"
                    maxLength={120}
                  />
                </label>
                <label className="text-sm font-medium sm:col-span-2">
                  Weekly study goal (minutes)
                  <input
                    type="number"
                    min={15}
                    max={1680}
                    step={15}
                    className="mt-2 block w-full rounded-lg border bg-background p-3"
                    value={weeklyGoal}
                    onChange={(e) => setWeeklyGoal(Number(e.target.value))}
                  />
                </label>
                <button
                  onClick={() => void startPractice()}
                  disabled={busy || !subject.trim() || !topic.trim()}
                  className="inline-flex justify-center gap-2 rounded-lg bg-primary px-5 py-3 font-medium text-primary-foreground disabled:opacity-50"
                >
                  <Sparkles className="h-4 w-4" />
                  {busy ? "Creating…" : "Start practice"}
                </button>
              </section>
            ) : (
              <section className="space-y-5 rounded-2xl border bg-card p-5 sm:p-7">
                <button
                  onClick={() => {
                    setQuestion(null);
                    setResult(null);
                  }}
                  className="inline-flex items-center gap-2 text-sm text-muted-foreground"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Choose another topic
                </button>
                <div>
                  <p className="text-sm text-muted-foreground">
                    AI-generated practice · {question.subject} / {question.topic} · Difficulty{" "}
                    {question.difficulty}/5
                  </p>
                  <h2 className="mt-3 text-xl font-semibold">{question.prompt}</h2>
                </div>
                <fieldset disabled={Boolean(result)} className="space-y-2">
                  <legend className="sr-only">Choose an answer</legend>
                  {question.choices.map((choice, index) => (
                    <label
                      key={index}
                      className={`flex cursor-pointer gap-3 rounded-xl border p-4 ${selected === index ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
                    >
                      <input
                        type="radio"
                        name="tutor-answer"
                        checked={selected === index}
                        onChange={() => setSelected(index)}
                      />
                      <span>{choice}</span>
                    </label>
                  ))}
                </fieldset>
                {!result ? (
                  <button
                    onClick={() => void submit()}
                    disabled={busy || selected === null}
                    className="rounded-lg bg-primary px-5 py-3 text-primary-foreground disabled:opacity-50"
                  >
                    {busy ? "Checking…" : "Submit answer"}
                  </button>
                ) : (
                  <div
                    className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4"
                    role="status"
                  >
                    <h3 className="font-semibold">
                      {result.correct ? "Correct" : "Review this answer"}
                    </h3>
                    {!result.correct && result.hint && (
                      <p>
                        <strong>Hint:</strong> {result.hint}
                      </p>
                    )}
                    <p>
                      <strong>Explanation:</strong> {result.explanation}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Generated study material may be incorrect. Compare it with your course
                      materials.
                    </p>
                    <div className="flex flex-wrap gap-3">
                      <button
                        onClick={() => {
                          setQuestion(null);
                          setResult(null);
                        }}
                        className="rounded-lg bg-primary px-4 py-2 text-primary-foreground"
                      >
                        Next question
                      </button>
                      <button
                        onClick={() =>
                          void tutorRequest({
                            action: "report",
                            questionId: question.id,
                            reason:
                              window.prompt("What seems incorrect?") ??
                              "Please review this question.",
                          })
                        }
                        className="inline-flex items-center gap-2 rounded-lg border px-4 py-2"
                      >
                        <Flag className="h-4 w-4" />
                        Report material
                      </button>
                    </div>
                  </div>
                )}
              </section>
            )}
            <section className="rounded-2xl border p-5">
              <h2 className="text-lg font-semibold">Recent practice</h2>
              {query.data.attempts.length ? (
                <ul className="mt-3 divide-y">
                  {query.data.attempts.slice(0, 8).map((attempt) => (
                    <li key={attempt.id} className="py-3">
                      <p className="font-medium">
                        {attempt.subject} · {attempt.topic}
                      </p>
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        {attempt.prompt}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  Your history and topic progress will appear after your first attempt.
                </p>
              )}
            </section>
          </>
        )}
      </main>
    </AppShell>
  );
}
function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 text-primary">
        {icon}
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
      </div>
      <p className="mt-3 text-xl font-semibold">{value}</p>
    </div>
  );
}
