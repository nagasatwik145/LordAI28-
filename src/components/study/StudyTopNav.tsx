import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  BookOpen,
  Target,
  MessageSquare,
  Brain,
  FileQuestion,
  Calendar,
  TrendingUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { StudyView } from "./types";
import { STUDY_VIEWS } from "./types";

interface StudyTopNavProps {
  activeView: StudyView;
  onViewChange: (view: StudyView) => void;
}

const VIEW_ICONS: Record<StudyView, LucideIcon> = {
  dashboard: LayoutDashboard,
  concepts: BookOpen,
  practice: Target,
  tutor: MessageSquare,
  flashcards: Brain,
  exams: FileQuestion,
  planner: Calendar,
  progress: TrendingUp,
};

export function StudyTopNav({ activeView, onViewChange }: StudyTopNavProps) {
  return (
    <nav
      className="w-full min-w-0 border-b border-border/40 bg-background/60 backdrop-blur-sm"
      aria-label="Study sections"
    >
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center gap-1 px-2 py-1.5 overflow-x-auto">
          {STUDY_VIEWS.map(({ id, label }) => {
            const Icon = VIEW_ICONS[id];
            const active = id === activeView;
            return (
              <motion.button
                key={id}
                onClick={() => onViewChange(id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-all duration-200 whitespace-nowrap",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  active
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-muted/20 hover:text-foreground",
                )}
              >
                <Icon
                  className={cn(
                    "h-4 w-4 transition-colors",
                    active ? "text-primary" : "text-muted-foreground/60",
                  )}
                />
                {label}
                {active && (
                  <motion.div
                    layoutId="study-nav-indicator"
                    className="absolute inset-0 -z-10 rounded-lg bg-primary/5"
                    style={{ boxShadow: "0 0 12px rgba(66,133,244,0.2)" }}
                  />
                )}
              </motion.button>
            );
          })}
          <a
            href="/personal-tutor"
            className="flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium text-amber-600 transition-colors hover:bg-amber-500/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label="Personal Tutor, LORD Pro feature"
          >
            <Brain className="h-4 w-4" />
            Personal Tutor <span className="text-[10px] font-bold">PRO</span>
          </a>
        </div>
      </div>
    </nav>
  );
}
