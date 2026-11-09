import { useState } from "react";
import { Copy, Check, RefreshCcw, Pin, ThumbsUp, ThumbsDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function Avatar() {
  return (
    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10">
      <span className="font-display text-[10px] font-bold text-primary">L</span>
    </div>
  );
}

export function EmptyState({ onPick }: { onPick: (s: string) => void }) {
  const suggestions = [
    "Summarize the key ideas in Sapiens.",
    "Plan a 7-day deep work schedule.",
    "Explain async/await in TypeScript with a code example.",
    "Give me a research brief on quantum computing.",
  ];
  return (
    <div className="flex h-full flex-col items-center justify-center px-4 text-center">
      <div className="mb-3 font-display text-xl font-semibold tracking-tight text-foreground">
        What can I help with?
      </div>
      <p className="mb-6 max-w-md text-sm leading-6 text-muted-foreground">
        Issue a directive and I shall respond. Pick a model above to bias the active model.
      </p>
      <div className="flex w-full max-w-2xl flex-wrap justify-center gap-2">
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="rounded-full border border-border bg-white/[0.035] px-3 py-2 text-left text-xs text-muted-foreground transition-[border-color,color,background-color,transform] duration-200 hover:-translate-y-px hover:border-primary/40 hover:bg-primary/[0.07] hover:text-foreground active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

export function MessageActions({
  text,
  canRegenerate,
  onRegenerate,
  pinned,
  feedback,
  onPin,
  onFeedback,
  onStudy,
}: {
  text: string;
  canRegenerate: boolean;
  onRegenerate: () => void;
  pinned: boolean;
  feedback?: "up" | "down";
  onPin: () => void;
  onFeedback: (value: "up" | "down") => void;
  onStudy?: (kind: "flashcards" | "quiz" | "plan") => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="mt-2 flex items-center gap-1">
      <button
        onClick={copy}
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition",
          copied
            ? "text-[var(--hud-success)]"
            : "text-muted-foreground hover:bg-primary/10 hover:text-primary",
        )}
        aria-label="Copy message"
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {copied ? "Copied" : "Copy"}
      </button>
      {canRegenerate && (
        <button
          onClick={onRegenerate}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition hover:bg-primary/10 hover:text-primary"
          aria-label="Regenerate response"
        >
          <RefreshCcw className="h-3 w-3" />
          Regenerate
        </button>
      )}
      <button
        type="button"
        onClick={onPin}
        aria-pressed={pinned}
        aria-label={pinned ? "Unpin answer" : "Pin answer"}
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px]",
          pinned ? "text-amber-400" : "text-muted-foreground hover:text-primary",
        )}
      >
        <Pin className="h-3 w-3" />
        {pinned ? "Pinned" : "Pin"}
      </button>
      <button
        type="button"
        onClick={() => onFeedback("up")}
        aria-label="Helpful answer"
        aria-pressed={feedback === "up"}
        className={cn(
          "rounded-md p-1",
          feedback === "up" ? "text-emerald-400" : "text-muted-foreground hover:text-primary",
        )}
      >
        <ThumbsUp className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={() => onFeedback("down")}
        aria-label="Unhelpful answer"
        aria-pressed={feedback === "down"}
        className={cn(
          "rounded-md p-1",
          feedback === "down" ? "text-rose-400" : "text-muted-foreground hover:text-primary",
        )}
      >
        <ThumbsDown className="h-3 w-3" />
      </button>
      {onStudy && (
        <details className="relative">
          <summary className="cursor-pointer list-none rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:text-primary">
            Study tools ▾
          </summary>
          <div className="absolute left-0 z-20 mt-1 flex min-w-36 flex-col rounded-lg border border-border bg-background p-1 shadow-xl">
            <button
              type="button"
              onClick={() => onStudy("flashcards")}
              className="rounded px-2 py-1.5 text-left text-xs hover:bg-primary/10"
            >
              Make flashcards
            </button>
            <button
              type="button"
              onClick={() => onStudy("quiz")}
              className="rounded px-2 py-1.5 text-left text-xs hover:bg-primary/10"
            >
              Create a quiz
            </button>
            <button
              type="button"
              onClick={() => onStudy("plan")}
              className="rounded px-2 py-1.5 text-left text-xs hover:bg-primary/10"
            >
              Build study plan
            </button>
          </div>
        </details>
      )}
    </div>
  );
}
