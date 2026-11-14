import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { motion, useReducedMotion, useScroll, useSpring } from "framer-motion";
import type { ReactNode } from "react";
import {
  ArrowDown,
  ArrowRight,
  AppWindow,
  AudioLines,
  BrainCircuit,
  CalendarDays,
  Check,
  ChevronRight,
  Code2,
  FileText,
  FolderOpen,
  Gamepad2,
  GraduationCap,
  Layers3,
  LockKeyhole,
  BarChart3,
  Bell,
  Image as ImageIcon,
  MessageSquareText,
  Network,
  NotebookTabs,
  Search,
  Settings,
  Sparkles,
  Target,
  UserRound,
  ChartNoAxesCombined,
  Users,
  Workflow,
} from "lucide-react";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import "./experience.css";

export const Route = createFileRoute("/experience")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user) {
      throw redirect({ to: "/dashboard", replace: true });
    }
  },
  head: () => ({
    meta: [
      { title: "Experience LORD AI — Intelligence Beyond Assistance" },
      {
        name: "description",
        content:
          "Explore LORD AI's chat, voice, learning, planning, creation, and productivity spaces.",
      },
    ],
  }),
  component: ExperiencePage,
});

type GuestAction = (path?: "/chat" | "/voice") => Promise<void>;

export function ExperiencePage() {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const [startingDemo, setStartingDemo] = useState(false);
  const [demoError, setDemoError] = useState("");

  const startDemo: GuestAction = async (path = "/chat") => {
    if (startingDemo) return;
    setStartingDemo(true);
    setDemoError("");
    try {
      const response = await fetch("/api/guest/session", {
        method: "POST",
        credentials: "same-origin",
      });
      const payload = (await response.json().catch(() => null)) as { active?: boolean } | null;
      if (!response.ok || !payload?.active)
        throw new Error("Demo access could not be started. Please try again.");
      await navigate({ to: path, replace: true });
    } catch (error) {
      setDemoError(error instanceof Error ? error.message : "Demo access could not be started.");
    } finally {
      setStartingDemo(false);
    }
  };

  return (
    <main className="experience-page">
      <ScrollProgress />
      <div className="experience-ambient" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <ExperienceNav onDemo={() => void startDemo()} busy={startingDemo} />
      <ExperienceHero
        reduceMotion={!!reduceMotion}
        onDemo={() => void startDemo()}
        busy={startingDemo}
      />
      {demoError && (
        <p className="experience-toast" role="alert">
          {demoError}
        </p>
      )}
      <ProductOverview />
      <FeatureShowcase />
      <FeatureBentoGrid />
      <EcosystemSection />
      <ProductivitySection />
      <ExperienceCTA onDemo={() => void startDemo()} busy={startingDemo} />
    </main>
  );
}

function ExperienceNav({ onDemo, busy }: { onDemo: () => void; busy: boolean }) {
  return (
    <header className="experience-nav-wrap">
      <nav className="experience-nav" aria-label="Experience navigation">
        <Link to="/" className="experience-brand">
          <img src="/lord-icon.png" alt="" /> LORD<span>AI</span>
        </Link>
        <div className="experience-nav-links">
          <Link to="/" aria-current="page">
            Experience
          </Link>
          <a href="/intelligence">Intelligence</a>
          <button type="button" onClick={onDemo} disabled={busy}>
            {busy ? "Starting…" : "Demo"}
          </button>
        </div>
        <Link to="/auth" className="experience-enter">
          Enter LORD <ArrowRight size={15} />
        </Link>
      </nav>
    </header>
  );
}

export function ExperienceHero({
  reduceMotion,
  onDemo,
  busy,
}: {
  reduceMotion: boolean;
  onDemo: () => void;
  busy: boolean;
}) {
  return (
    <section className="experience-hero" id="intelligence">
      <div className="experience-hero-copy">
        <motion.div
          className="experience-kicker"
          initial={reduceMotion ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65 }}
        >
          <span className="kicker-orb">
            <Sparkles size={15} />
          </span>{" "}
          PERSONAL INTELLIGENCE, IN MOTION
        </motion.div>
        <motion.h1
          initial={reduceMotion ? false : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.08 }}
        >
          Experience Intelligence.
          <br />
          <span>Beyond Expectations.</span>
        </motion.h1>
        <motion.p
          className="experience-hero-subtitle"
          initial={reduceMotion ? false : { opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.2 }}
        >
          Discover a smarter way to think, create, organize, learn, and accomplish more. Explore
          everything LORD AI brings together in one intelligent workspace.
        </motion.p>
        <motion.div
          className="experience-hero-actions"
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, delay: 0.3 }}
        >
          <a className="experience-button experience-button-primary" href="#experience-features">
            Explore the experience <ArrowDown size={16} />
          </a>
          <button
            className="experience-button experience-button-quiet"
            type="button"
            onClick={onDemo}
            disabled={busy}
          >
            {busy ? "Opening demo…" : "Try the demo"} <ArrowRight size={16} />
          </button>
        </motion.div>
        <div className="experience-proof">
          <span>
            <Check size={13} /> Real product interfaces
          </span>
          <span>
            <Check size={13} /> Guest demo available
          </span>
          <span>
            <LockKeyhole size={13} /> Account protected
          </span>
        </div>
      </div>
      <motion.a
        className="hero-interface"
        href="#product-overview"
        aria-label="Jump to LORD AI chat workspace preview"
        initial={reduceMotion ? false : { opacity: 0, y: 32, rotateX: 5 }}
        animate={{ opacity: 1, y: 0, rotateX: 0 }}
        transition={{ duration: 1, delay: 0.35 }}
      >
        <div className="hero-interface-glow" />
        <img
          src="/images/experience/chat.webp"
          alt="Live capture of the LORD AI guest chat workspace, including model controls and message composer"
          fetchPriority="high"
        />
        <div className="hero-interface-caption">
          <span className="hero-live-dot" /> LIVE PRODUCT CAPTURE <span>CHAT WORKSPACE</span>
        </div>
      </motion.a>
      <a href="#product-overview" className="experience-scroll-cue">
        <span /> Scroll to explore
      </a>
    </section>
  );
}

export function ProductOverview() {
  return (
    <section className="experience-section overview-section" id="product-overview">
      <SectionHeading
        eyebrow="THE WORKSPACE"
        title={
          <>
            A clear place to <span>begin.</span>
          </>
        }
        text="LORD opens with a focused conversation space: choose a model and response mode, ask a question, and keep the work moving from one message to the next."
      />
      <div className="overview-layout">
        <div className="overview-metrics">
          <div className="overview-label">
            <span className="small-signal" /> THE CHAT WORKSPACE
          </div>
          <h3>
            Ideas in.
            <br />
            <span>Momentum out.</span>
          </h3>
          <p>
            The captured guest interface puts model and mode controls, suggested prompts,
            attachments, and message composition in one view. Start a 10-minute demo without
            creating an account.
          </p>
          <ul>
            <li>
              <Check size={15} /> Switch between available models and response modes
            </li>
            <li>
              <Check size={15} /> Start with suggested prompts or your own question
            </li>
            <li>
              <Check size={15} /> Explore Chat and Voice in guest mode
            </li>
          </ul>
          <Link className="text-link" to="/chat">
            Open the chat experience <ArrowRight size={15} />
          </Link>
        </div>
        <ScreenshotFrame
          src="/images/experience/chat.webp"
          alt="Captured LORD AI chat page with guest access banner, mode and model selection, starter prompts, and composer"
          className="overview-shot"
        />
      </div>
    </section>
  );
}

export function FeatureShowcase() {
  return (
    <section className="experience-section feature-section" id="experience-features">
      <SectionHeading
        eyebrow="EXPLORE THE EXPERIENCE"
        title={
          <>
            Intelligence that meets you <span>in the moment.</span>
          </>
        }
        text="Start with the experiences visitors can try now. Each preview below is an actual capture from the running LORD AI application."
      />
      <FeatureSpotlight
        number="01"
        label="CONVERSATIONAL AI"
        title="A conversation built for the next step."
        description="Ask, compare, plan, and reason with LORD. The chat workspace combines model and mode selection with a focused composer, useful starter prompts, and support for attachments."
        points={[
          "Model and response mode controls",
          "Starter prompts and attachment entry",
          "Guest demo starts directly in Chat",
        ]}
        image="/images/experience/chat.webp"
        alt="Real LORD AI Chat workspace captured in guest mode"
        route="/chat"
        reverse={false}
        icon={<MessageSquareText />}
      />
      <FeatureSpotlight
        number="02"
        label="VOICE ASSISTANT"
        title="Speak naturally. Keep the flow."
        description="Voice offers browser-based speech input with spoken replies and subtitles. It handles a turn, pauses while LORD responds, then reconnects for another utterance when the browser speech service supports it."
        points={[
          "Speech recognition with text fallback",
          "Toggle subtitles and spoken replies",
          "Mission actions ask for confirmation",
        ]}
        image="/images/experience/voice-assistant.webp"
        alt="Real LORD AI Voice Assistant interface with conversation controls and guest access"
        route="/voice"
        reverse
        icon={<AudioLines />}
      />
    </section>
  );
}

function FeatureSpotlight({
  number,
  label,
  title,
  description,
  points,
  image,
  alt,
  route,
  reverse,
  icon,
}: {
  number: string;
  label: string;
  title: string;
  description: string;
  points: string[];
  image: string;
  alt: string;
  route: "/chat" | "/voice";
  reverse: boolean;
  icon: ReactNode;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.article
      className={`feature-spotlight ${reverse ? "feature-spotlight-reverse" : ""}`}
      initial={reduced ? false : { opacity: 0, y: 32 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.16 }}
      transition={{ duration: 0.65 }}
    >
      <div className="feature-copy">
        <div className="feature-ordinal">
          <span>{number}</span>
          <i />
          {label}
        </div>
        <div className="feature-icon">{icon}</div>
        <h3>{title}</h3>
        <p>{description}</p>
        <ul className="feature-points">
          {points.map((point) => (
            <li key={point}>
              <Check size={15} /> {point}
            </li>
          ))}
        </ul>
        <Link className="text-link" to={route}>
          Explore in LORD <ArrowRight size={15} />
        </Link>
      </div>
      <ScreenshotFrame src={image} alt={alt} className="feature-shot" />
    </motion.article>
  );
}

export function FeatureBentoGrid() {
  const groups = [
    {
      icon: GraduationCap,
      tag: "LEARN",
      title: "Study",
      description:
        "Move among concept review, practice, flashcards, tutor, exams, planner, and progress views.",
      href: "/study",
    },
    {
      icon: CalendarDays,
      tag: "ORGANIZE",
      title: "Calendar & Tasks",
      description:
        "Shape a timeline with events and track tasks, due dates, priorities, completion, and notifications.",
      href: "/calendar",
    },
    {
      icon: Gamepad2,
      tag: "CREATE",
      title: "WorldForge",
      description:
        "Turn a structured prompt into a playable 2D or 3D game, then customize and export its project.",
      href: "/create-apka-jalwa",
    },
    {
      icon: FileText,
      tag: "UNDERSTAND",
      title: "Documents & Research",
      description:
        "Ask questions about uploaded material, create study aids, or configure focused web research.",
      href: "/documents",
    },
    {
      icon: Code2,
      tag: "BUILD",
      title: "Developer Lab",
      description:
        "Analyze code, generate tests, inspect errors, review a file, or compose an HTTP request.",
      href: "/developer-lab",
    },
    {
      icon: BrainCircuit,
      tag: "REFLECT",
      title: "Memory & Mind Graph",
      description:
        "Review saved memories and explore the relationships LORD has recorded across supported workspaces.",
      href: "/memory",
    },
    {
      icon: FolderOpen,
      tag: "ORGANIZE",
      title: "Projects",
      description: "Create, search, and sort project spaces to keep related work grouped together.",
      href: "/projects",
    },
    {
      icon: Layers3,
      tag: "MAKE",
      title: "Anything Studio",
      description:
        "Shape a project brief into a spec, choose deliverables, and generate or revise outputs.",
      href: "/anything-studio",
    },
    {
      icon: Users,
      tag: "SHARE",
      title: "Community",
      description: "Discover and share supported LORD creations with creator and moderation tools.",
      href: "/community",
    },
    {
      icon: Bell,
      tag: "PLAN",
      title: "Daily Briefing",
      description:
        "Review the day’s tasks and events, focus suggestions, and task actions in one view.",
      href: "/command-center",
    },
    {
      icon: Workflow,
      tag: "TOOLS",
      title: "Command Center",
      description:
        "Open specialized browser, files, automation, device, and vision panels where configured.",
      href: "/command-center",
    },
    {
      icon: ImageIcon,
      tag: "IMAGINE",
      title: "Image Generation",
      description:
        "Create prompt-based images and review them in the gallery when a provider is configured.",
      href: "/images",
    },
    {
      icon: Settings,
      tag: "PERSONALIZE",
      title: "Settings & Statistics",
      description: "Tune voice and privacy preferences, then review recorded account activity.",
      href: "/settings",
    },
    {
      icon: BarChart3,
      tag: "OPERATIONS",
      title: "Health Center",
      description: "Service diagnostics are available only to the approved administrator account.",
      href: "/observability",
    },
    {
      icon: AppWindow,
      tag: "CREATE",
      title: "AI Canvas",
      description:
        "Draft and revise AI-generated documents, code, tables, flowcharts, mind maps, notes, and study or research artifacts; copy or export supported formats.",
      href: "/canvas",
    },
    {
      icon: Network,
      tag: "KNOWLEDGE",
      title: "Knowledge 2.0",
      description:
        "Explore the knowledge interface for entity extraction, knowledge graph, cross-document reasoning, and recent entities.",
      href: "/knowledge2",
    },
    {
      icon: UserRound,
      tag: "LORD PRO",
      title: "Personal Tutor",
      description:
        "A Pro learning area for adaptive question practice, recorded results, and a weekly study goal.",
      href: "/personal-tutor",
    },
    {
      icon: NotebookTabs,
      tag: "FIND",
      title: "Workspace Search",
      description:
        "Search across conversations, messages, memories, knowledge, notes, tasks, artifacts, and documents.",
      href: "/search",
    },
    {
      icon: ChartNoAxesCombined,
      tag: "OVERVIEW",
      title: "Dashboards & Activity",
      description:
        "Review workspace statistics and the recent activity feed in a dedicated dashboard view.",
      href: "/dashboards",
    },
    {
      icon: Sparkles,
      tag: "UPGRADE",
      title: "LORD Pro",
      description:
        "The upgrade page presents LORD Pro subscription options; purchase availability is not verified here.",
      href: "/upgrade",
    },
  ];
  return (
    <section className="experience-section bento-section">
      <SectionHeading
        eyebrow="MORE WAYS TO MOVE FORWARD"
        title={
          <>
            Purpose-built spaces for <span>real work.</span>
          </>
        }
        text="Authenticated modules are grouped by the work they help you do. These descriptions reflect the current application interface; protected pages require an account."
      />
      <div className="feature-bento">
        {groups.map(({ icon: Icon, tag, title, description, href }, index) => (
          <article className={`bento-item bento-item-${index + 1}`} key={title}>
            <div className="bento-top">
              <span className="bento-icon">
                <Icon size={19} />
              </span>
              <span>{tag}</span>
            </div>
            <h3>{title}</h3>
            <p>{description}</p>
            <div className="bento-lines" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
            <a href={href} aria-label={`Open ${title}`}>
              Open in LORD <ChevronRight size={15} />
            </a>
          </article>
        ))}
      </div>
      <p className="protected-note">
        <LockKeyhole size={14} /> These spaces require a signed-in account. The guest demo currently
        includes Chat and Voice.
      </p>
    </section>
  );
}

export function EcosystemSection() {
  const nodes = [
    { icon: MessageSquareText, name: "Chat", note: "Ask and explore" },
    { icon: AudioLines, name: "Voice", note: "Speak and listen" },
    { icon: GraduationCap, name: "Study", note: "Practice and review" },
    { icon: Workflow, name: "Daily Briefing", note: "Review the day" },
    { icon: Layers3, name: "Studio", note: "Generate deliverables" },
  ];
  return (
    <section className="ecosystem-section">
      <div className="ecosystem-copy">
        <div className="section-eyebrow">ONE INTELLIGENT WORKSPACE</div>
        <h2>
          Choose the space
          <br />
          that fits <span>your focus.</span>
        </h2>
        <p>
          Conversation, voice, learning, planning, and creation each have a dedicated space in LORD
          AI. Move between them when the task changes; the app navigation keeps those tools close.
        </p>
      </div>
      <div className="ecosystem-map" aria-label="LORD AI product spaces">
        <div className="ecosystem-orbit orbit-one" />
        <div className="ecosystem-orbit orbit-two" />
        <div className="ecosystem-core">
          <img src="/lord-icon.png" alt="LORD AI" />
          <span>LORD AI</span>
          <small>INTELLIGENT WORKSPACE</small>
        </div>
        {nodes.map(({ icon: Icon, name, note }, i) => (
          <div className={`ecosystem-node node-${i + 1}`} key={name}>
            <Icon size={17} />
            <strong>{name}</strong>
            <small>{note}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function ProductivitySection() {
  return (
    <section className="experience-section productivity-section">
      <div className="productivity-heading">
        <div>
          <div className="section-eyebrow">DESIGNED FOR PRODUCTIVITY</div>
          <h2>
            Make progress
            <br />
            <span>visible.</span>
          </h2>
        </div>
        <p>
          Give the next action a place to land. LORD combines timed focus blocks and measurable
          goals with task reminders, calendar events, and a daily briefing view.
        </p>
      </div>
      <div className="productivity-rail">
        <div>
          <Target />
          <b>Focus sessions</b>
          <p>A built-in 25-minute focus / 5-minute break timer.</p>
        </div>
        <div>
          <CalendarDays />
          <b>Tasks & timeline</b>
          <p>Track priorities, due times, events, and completion.</p>
        </div>
        <div>
          <Search />
          <b>Research & review</b>
          <p>Use focused research and document-based study aids.</p>
        </div>
        <div>
          <Network />
          <b>Remember context</b>
          <p>Review and manage saved memory with privacy controls.</p>
        </div>
      </div>
    </section>
  );
}

export function ExperienceCTA({ onDemo, busy }: { onDemo: () => void; busy: boolean }) {
  return (
    <section className="experience-cta">
      <div className="cta-aurora" aria-hidden="true" />
      <div className="section-eyebrow">READY WHEN YOU ARE</div>
      <h2>
        Your Intelligence.
        <br />
        <span>Your Command.</span>
      </h2>
      <p>Everything you need to move from ideas to meaningful outcomes starts with LORD AI.</p>
      <div className="experience-hero-actions">
        <Link className="experience-button experience-button-primary" to="/auth">
          Enter LORD <ArrowRight size={16} />
        </Link>
        <button
          className="experience-button experience-button-quiet"
          onClick={onDemo}
          type="button"
          disabled={busy}
        >
          {busy ? "Starting…" : "Explore the demo"} <ArrowRight size={16} />
        </button>
      </div>
    </section>
  );
}

export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 110, damping: 28 });
  return <motion.div className="experience-progress" style={{ scaleX }} aria-hidden="true" />;
}

function ScreenshotFrame({
  src,
  alt,
  className = "",
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  return (
    <div className={`screenshot-frame ${className}`}>
      <div className="screenshot-frame-top">
        <span />
        <span />
        <span />
        <b>LORD AI · PRODUCT PREVIEW</b>
      </div>
      <img src={src} alt={alt} loading="lazy" decoding="async" />
      <div className="screenshot-frame-reflection" />
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  text,
}: {
  eyebrow: string;
  title: ReactNode;
  text: string;
}) {
  return (
    <div className="experience-section-heading">
      <div className="section-eyebrow">{eyebrow}</div>
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}
