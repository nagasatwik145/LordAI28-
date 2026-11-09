import { AnimatePresence, motion } from "framer-motion";
import { BookOpenCheck, Check, Mic, PenLine, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ProblemSolvingPreference } from "@/lib/problem-solving-intent";
import { cn } from "@/lib/utils";

export interface ProblemSolvingSelectorProps {
  open: boolean;
  subject?: string | null;
  prompt?: string;
  onSubmit: (preference: ProblemSolvingPreference) => void;
}

const options: Array<{
  value: ProblemSolvingPreference;
  label: string;
  description: string;
  icon: typeof Sparkles;
}> = [
  {
    value: "work-together",
    label: "Work through it together",
    description: "Learn step by step and collaborate with LORD.",
    icon: BookOpenCheck,
  },
  {
    value: "show-answer",
    label: "Show me the answer",
    description: "Get the complete, exam-ready solution.",
    icon: Sparkles,
  },
  {
    value: "quiz",
    label: "Quiz me on similar questions",
    description: "Practice with incremental difficulty and feedback.",
    icon: PenLine,
  },
  {
    value: "voice",
    label: "Talk through it using Voice Mode",
    description: "Listen, discuss, and verbalize the solution out loud.",
    icon: Mic,
  },
];

export function ProblemSolvingSelector({
  open,
  subject,
  prompt,
  onSubmit,
}: ProblemSolvingSelectorProps) {
  const [selected, setSelected] = useState<ProblemSolvingPreference | null>(null);

  useEffect(() => {
    if (!open) setSelected(null);
  }, [open]);

  const subjectLabel = useMemo(() => {
    if (!subject) return "problem";
    return `${subject} problem`;
  }, [subject]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="problem-solver-selector"
          initial={{ opacity: 0, y: 10, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.99 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="mb-4 overflow-hidden rounded-[28px] border border-primary/20 bg-slate-950/85 shadow-[0_18px_60px_rgba(0,0,0,0.36)] backdrop-blur-xl"
        >
          <div className="border-b border-white/10 bg-gradient-to-r from-primary/10 via-primary/5 to-red-500/5 px-4 py-4 sm:px-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-200/75">
              Problem solving
            </p>
            <h3 className="mt-2 text-lg font-semibold text-white sm:text-xl">
              How would you like LORD to help you solve this?
            </h3>
            {prompt ? (
              <p className="mt-2 max-w-2xl text-sm text-slate-300">
                {prompt.slice(0, 120)}
                {prompt.length > 120 ? "…" : ""}
              </p>
            ) : null}
          </div>

          <div
            className="space-y-2 p-3 sm:p-4"
            role="radiogroup"
            aria-label="Problem solving options"
          >
            {options.map((option) => {
              const Icon = option.icon;
              const isSelected = selected === option.value;

              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => setSelected(option.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    setSelected(option.value);
                  }}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-2xl border px-3 py-3 text-left transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950",
                    isSelected
                      ? "border-primary/60 bg-primary/10 shadow-[0_0_0_1px_rgba(96,165,250,0.25)]"
                      : "border-white/10 bg-black/10 hover:border-white/20 hover:bg-white/[0.03]",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                      isSelected
                        ? "border-primary bg-primary text-white"
                        : "border-white/20 bg-slate-900 text-transparent",
                    )}
                    aria-hidden="true"
                  >
                    {isSelected ? <Check className="h-3 w-3" /> : null}
                  </span>

                  <span
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-xl border",
                      isSelected
                        ? "border-primary/50 bg-primary/15 text-blue-100"
                        : "border-white/10 bg-white/5 text-slate-200",
                    )}
                    aria-hidden="true"
                  >
                    <Icon className="h-4 w-4" />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-white sm:text-[15px]">
                      {option.label}
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-slate-300">
                      {option.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-white/10 bg-black/10 px-4 py-3 sm:px-5">
            <p className="text-xs text-slate-300">
              {subject
                ? `Detected ${subjectLabel}.`
                : "This request looks like a problem-solving prompt."}
            </p>
            <button
              type="button"
              onClick={() => selected && onSubmit(selected)}
              disabled={!selected}
              className={cn(
                "rounded-full px-4 py-2 text-sm font-semibold text-white transition-all duration-150",
                selected
                  ? "bg-gradient-to-r from-primary to-blue-500 shadow-[0_8px_24px_rgba(59,130,246,0.3)] hover:brightness-110"
                  : "cursor-not-allowed bg-slate-700 text-slate-400",
              )}
            >
              Submit
            </button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
