import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { motion, useReducedMotion, useScroll, useSpring } from "framer-motion";
import type { ReactNode } from "react";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  AudioLines,
  BrainCircuit,
  Check,
  ChevronRight,
  CircleHelp,
  Code2,
  FileText,
  Image as ImageIcon,
  Layers3,
  LockKeyhole,
  MessageSquareText,
  Network,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Workflow,
  Zap,
} from "lucide-react";
import { useState } from "react";
import "./intelligence.css";

export const Route = createFileRoute("/intelligence")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "LORD Intelligence — How LORD Understands, Remembers & Assists" },
      {
        name: "description",
        content:
          "Explore how LORD AI routes models, assembles context, retrieves user-controlled memory, searches sources, and streams responses.",
      },
    ],
  }),
  component: IntelligencePage,
});

type GuestPath = "/chat" | "/voice";

function IntelligencePage() {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const [demoBusy, setDemoBusy] = useState(false);
  const [error, setError] = useState("");
  const [activeNode, setActiveNode] = useState("assistant");
  const [activeDemo, setActiveDemo] = useState("conversation");

  const openGuest = async (path: GuestPath = "/chat") => {
    if (demoBusy) return;
    setDemoBusy(true);
    setError("");
    try {
      const response = await fetch("/api/guest/session", {
        method: "POST",
        credentials: "same-origin",
      });
      const payload = (await response.json().catch(() => null)) as { active?: boolean } | null;
      if (!response.ok || !payload?.active) {
        throw new Error("The live demo could not start. Please try again.");
      }
      await navigate({ to: path, replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The live demo could not start.");
    } finally {
      setDemoBusy(false);
    }
  };

  return (
    <main className="intelligence-page">
      <ScrollProgress />
      <div className="intel-atmosphere" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <IntelligenceNav onDemo={() => void openGuest()} busy={demoBusy} />
      <IntelligenceHero reduced={!!reduceMotion} onDemo={() => void openGuest()} busy={demoBusy} />
      {error && (
        <p className="intel-error" role="alert">
          {error}
        </p>
      )}
      <IntelligenceCore activeNode={activeNode} onSelect={setActiveNode} />
      <ArchitectureSection />
      <CapabilitiesSection onOpenGuest={(path) => void openGuest(path)} busy={demoBusy} />
      <LiveExploration
        active={activeDemo}
        onSelect={setActiveDemo}
        onOpenGuest={(path) => void openGuest(path)}
        busy={demoBusy}
      />
      <IntelligenceClosing onDemo={() => void openGuest()} busy={demoBusy} />
    </main>
  );
}

function IntelligenceNav({ onDemo, busy }: { onDemo: () => void; busy: boolean }) {
  return (
    <header className="intel-nav-wrap">
      <nav className="intel-nav" aria-label="LORD AI navigation">
        <Link to="/auth" className="intel-brand">
          <img src="/lord-icon.png" alt="" /> LORD<span>AI</span>
        </Link>
        <div className="intel-nav-links">
          <Link to="/">Experience</Link>
          <a href="#intelligence-core" aria-current="page">
            Intelligence
          </a>
          <button type="button" onClick={onDemo} disabled={busy}>
            {busy ? "Starting…" : "Demo"}
          </button>
        </div>
        <Link to="/auth" className="intel-enter">
          Enter LORD <ArrowRight size={15} />
        </Link>
      </nav>
    </header>
  );
}

function IntelligenceHero({
  reduced,
  onDemo,
  busy,
}: {
  reduced: boolean;
  onDemo: () => void;
  busy: boolean;
}) {
  return (
    <section className="intel-hero">
      <div className="intel-hero-copy">
        <motion.div
          className="intel-eyebrow"
          initial={reduced ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <span>
            <BrainCircuit size={15} />
          </span>{" "}
          THE THINKING LAYER OF LORD AI
        </motion.div>
        <motion.h1
          initial={reduced ? false : { opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.75, delay: 0.08 }}
        >
          Beyond Artificial Intelligence.
          <strong>Introducing LORD Intelligence.</strong>
        </motion.h1>
        <motion.p
          className="intel-hero-subtitle"
          initial={reduced ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, delay: 0.18 }}
        >
          More than responses. A smarter way to understand ideas, explore possibilities, connect
          knowledge and turn complex challenges into meaningful outcomes.
        </motion.p>
        <div className="intel-hero-actions">
          <a className="intel-button intel-button-primary" href="#intelligence-core">
            Explore the intelligence <ArrowDown size={15} />
          </a>
          <button
            className="intel-button intel-button-secondary"
            type="button"
            onClick={onDemo}
            disabled={busy}
          >
            {busy ? "Opening live demo…" : "Try LORD live"} <ArrowRight size={15} />
          </button>
        </div>
        <div className="intel-hero-proof">
          <span>
            <Check size={13} /> Grounded in the current implementation
          </span>
          <span>
            <LockKeyhole size={13} /> Credentials stay server-side
          </span>
        </div>
      </div>
      <NeuralCoreArt reduced={reduced} />
      <a href="#intelligence-core" className="intel-scroll-cue">
        <span /> Scroll to understand
      </a>
    </section>
  );
}

function NeuralCoreArt({ reduced }: { reduced: boolean }) {
  return (
    <motion.div
      className="neural-art"
      aria-label="Animated illustration of connected LORD Intelligence components"
      initial={reduced ? false : { opacity: 0, scale: 0.92, y: 18 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.9, delay: 0.2 }}
    >
      <div className="neural-aura" />
      <svg className="neural-wires" viewBox="0 0 900 420" aria-hidden="true">
        <defs>
          <linearGradient id="neural-wire-gradient" x1="0" x2="1" y1="1" y2="0">
            <stop stopColor="#26cbff" stopOpacity=".02" />
            <stop offset=".5" stopColor="#69baff" stopOpacity=".78" />
            <stop offset="1" stopColor="#bb73ff" stopOpacity=".08" />
          </linearGradient>
        </defs>
        <path d="M70 106 C190 80 245 160 350 190" />
        <path d="M40 290 C170 290 240 238 350 216" />
        <path d="M835 100 C700 90 625 160 550 190" />
        <path d="M862 300 C705 285 650 238 550 215" />
        <path d="M450 28 C450 94 450 130 450 164" />
        <path d="M450 256 C450 310 450 340 450 390" />
        <circle cx="145" cy="95" r="3" />
        <circle cx="260" cy="145" r="2" />
        <circle cx="100" cy="285" r="2" />
        <circle cx="275" cy="252" r="3" />
        <circle cx="740" cy="95" r="3" />
        <circle cx="635" cy="144" r="2" />
        <circle cx="790" cy="288" r="2" />
        <circle cx="624" cy="252" r="3" />
      </svg>
      <div className="neural-orbit neural-orbit-one" />
      <div className="neural-orbit neural-orbit-two" />
      <div className="neural-orbit neural-orbit-three" />
      <div className="neural-core">
        <span className="core-backlight" />
        <img src="/lord-icon.png" alt="" />
        <b>LORD</b>
        <small>INTELLIGENCE</small>
      </div>
      <span className="neural-particle particle-a" />
      <span className="neural-particle particle-b" />
      <span className="neural-particle particle-c" />
      <span className="neural-particle particle-d" />
      <div className="neural-tag neural-tag-model">
        <Zap size={13} /> MODEL ROUTING
      </div>
      <div className="neural-tag neural-tag-memory">
        <Network size={13} /> RELEVANT CONTEXT
      </div>
      <div className="neural-tag neural-tag-stream">
        <Activity size={13} /> LIVE STREAM
      </div>
    </motion.div>
  );
}

type IntelNodeId = "assistant" | "models" | "context" | "memory" | "sources" | "tools";
const intelNodes: Array<{
  id: IntelNodeId;
  label: string;
  detail: string;
  icon: typeof BrainCircuit;
}> = [
  {
    id: "assistant",
    label: "LORD assistant",
    detail:
      "The app's assistant prompt and request handler shape the response around the selected mode and current task.",
    icon: BrainCircuit,
  },
  {
    id: "models",
    label: "Model routing",
    detail:
      "Chat models come from a registry. Task, mode, access and attachment support filter candidates; provider availability is checked and a bounded fallback may be used before text is emitted.",
    icon: Layers3,
  },
  {
    id: "context",
    label: "Conversation context",
    detail:
      "Recent turns are kept within a context budget. Older turns can be summarized; app page, workflow, project and mode values are supplied as metadata.",
    icon: MessageSquareText,
  },
  {
    id: "memory",
    label: "User memory",
    detail:
      "When account memory and personalization are enabled, relevant confirmed, non-sensitive memories and project knowledge can be retrieved for the signed-in user.",
    icon: Network,
  },
  {
    id: "sources",
    label: "Web sources",
    detail:
      "Explicit web search, Reality Check and research flows can call the server-side Tavily integration. Search limits and provider availability apply.",
    icon: Search,
  },
  {
    id: "tools",
    label: "Permissioned tools",
    detail:
      "The separate LORD agent plans Command Center workflows through a tool registry and permission checks. Write actions can pause for user confirmation; general chat tool-calling is not enabled.",
    icon: ShieldCheck,
  },
];

export function IntelligenceCore({
  activeNode,
  onSelect,
}: {
  activeNode: string;
  onSelect: (id: string) => void;
}) {
  const reduceMotion = useReducedMotion();
  const selected = intelNodes.find((node) => node.id === activeNode) ?? intelNodes[0];
  return (
    <section className="intel-section intel-core-section" id="intelligence-core">
      <SectionIntro
        eyebrow="THE INTELLIGENCE CORE"
        title={
          <>
            One assistant. <span>Several real systems.</span>
          </>
        }
        description="LORD combines a server-side model gateway with conversation context, optional account memory, source search, and separately permissioned application tools. Select a node to see its actual role."
      />
      <div className="intel-core-layout">
        <div
          className="intel-constellation"
          aria-label="Interactive LORD Intelligence architecture nodes"
        >
          <svg viewBox="0 0 700 500" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="core-link" x1="0" y1="1" x2="1" y2="0">
                <stop stopColor="#29caff" stopOpacity=".1" />
                <stop offset=".55" stopColor="#66a7ff" stopOpacity=".75" />
                <stop offset="1" stopColor="#ad75ff" stopOpacity=".12" />
              </linearGradient>
            </defs>
            <path d="M350 250 L120 90 M350 250 L580 90 M350 250 L90 250 M350 250 L610 250 M350 250 L135 410 M350 250 L565 410" />
          </svg>
          <div className="constellation-center">
            <span>
              <BrainCircuit size={29} />
            </span>
            <b>LORD</b>
            <small>INTELLIGENCE</small>
          </div>
          {intelNodes.map(({ id, label, icon: Icon }, i) => (
            <button
              key={id}
              type="button"
              className={`constellation-node constellation-node-${i + 1} ${activeNode === id ? "is-active" : ""}`}
              onClick={() => onSelect(id)}
              aria-pressed={activeNode === id}
            >
              <Icon size={17} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <motion.aside
          className="intel-node-detail"
          key={selected.id}
          initial={reduceMotion ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.25 }}
        >
          <div className="node-detail-kicker">
            <span className="signal-dot" /> COMPONENT{" "}
            {String(intelNodes.findIndex((node) => node.id === selected.id) + 1).padStart(2, "0")}
          </div>
          <selected.icon size={23} className="node-detail-icon" />
          <h3>{selected.label}</h3>
          <p>{selected.detail}</p>
          <span className="node-detail-hint">Choose another node to explore the flow.</span>
        </motion.aside>
      </div>
      <p className="intel-note">
        <LockKeyhole size={13} /> Provider secrets stay on the server; model and source availability
        depends on deployment configuration.
      </p>
    </section>
  );
}

export function ArchitectureSection() {
  const steps = [
    {
      icon: MessageSquareText,
      title: "Input",
      text: "Validate message, mode and supported attachments.",
    },
    {
      icon: Settings2,
      title: "Route",
      text: "Classify the latest task and choose eligible model candidates.",
    },
    {
      icon: Network,
      title: "Context",
      text: "Add bounded conversation and optional user/project context.",
    },
    {
      icon: Search,
      title: "Sources",
      text: "When requested or warranted, retrieve web sources server-side.",
    },
    {
      icon: Activity,
      title: "Stream",
      text: "Stream the model response; report source and verification status.",
    },
  ];
  return (
    <section className="intel-architecture-section">
      <div className="intel-architecture-header">
        <div>
          <div className="intel-section-eyebrow">HOW A CHAT TURN FLOWS</div>
          <h2>
            From intent to <span>useful output.</span>
          </h2>
        </div>
        <p>
          This is the current chat path, simplified. Research and tool workflows have their own
          guarded routes; the diagram does not imply that every turn runs every step.
        </p>
      </div>
      <div className="architecture-flow">
        {steps.map(({ icon: Icon, title, text }, index) => (
          <div className="architecture-step" key={title}>
            <div className="architecture-step-top">
              <span className="architecture-icon">
                <Icon size={18} />
              </span>
              <small>0{index + 1}</small>
            </div>
            <h3>{title}</h3>
            <p>{text}</p>
            {index < steps.length - 1 && (
              <span className="architecture-connector">
                <ChevronRight size={17} />
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="architecture-branches">
        <span>
          <Network size={14} /> Account memory and project context are optional
        </span>
        <span>
          <Search size={14} /> Tavily lookup runs only for selected research paths
        </span>
        <span>
          <ShieldCheck size={14} /> LORD agent tools use a separate confirmation flow
        </span>
      </div>
    </section>
  );
}

function CapabilitiesSection({
  onOpenGuest,
  busy,
}: {
  onOpenGuest: (path: GuestPath) => void;
  busy: boolean;
}) {
  return (
    <section className="intel-section intel-capabilities" id="capabilities">
      <SectionIntro
        eyebrow="INTELLIGENCE CAPABILITIES"
        title={
          <>
            How LORD thinks, understands, <span>and assists.</span>
          </>
        }
        description="The capabilities below describe implemented flows and their boundaries. Provider-dependent behavior is labeled as such; no model benchmark or guaranteed result is implied."
      />
      <div className="intel-capability-list">
        <CapabilitySection
          index="01"
          eyebrow="ADVANCED AI REASONING"
          title="Choose a path that fits the question."
          body="The chat request classifies the latest task and applies a response mode such as Balanced, Coding, Creative or Reasoning. It filters registered model candidates by access, availability and attachment support. Any reasoning quality comes from the selected model; LORD does not expose private chain-of-thought."
          points={[
            "Mode-aware model candidate selection",
            "Availability-aware fallback before text starts",
            "Council and Reality Check are separate options with limits",
          ]}
          visual={<ModelRoutingVisual />}
          actionLabel="Try the live chat"
          onAction={() => onOpenGuest("/chat")}
          busy={busy}
        />
        <CapabilitySection
          index="02"
          eyebrow="CONTEXTUAL INTELLIGENCE"
          title="Keep the useful thread in view."
          body="LORD sends recent turns within a context budget, can summarize older turns, and adds current page, workflow, project and mode metadata. For a signed-in user, the chat path can also retrieve relevant memory and project knowledge when those controls allow it."
          points={[
            "Recent conversation kept within a token budget",
            "Older messages may be summarized",
            "Project and workflow context is bounded metadata",
          ]}
          reverse
          visual={
            <RealScreenshot
              src="/images/experience/chat.webp"
              alt="Real capture of the LORD AI guest Chat interface showing mode and model controls and the composer"
              label="LIVE CHAT INTERFACE"
            />
          }
          actionLabel="Open Chat demo"
          onAction={() => onOpenGuest("/chat")}
          busy={busy}
        />
        <CapabilitySection
          index="03"
          eyebrow="INTELLIGENT MEMORY"
          title="Relevant recall stays under your control."
          body="For authenticated users, LORD checks memory and personalization settings, then retrieves relevant confirmed memories and project knowledge. Suggested, archived, disabled, expired and sensitive memories are excluded. You can review, edit, pin, disable for context, or delete saved memories."
          points={[
            "User-scoped retrieval with relevance ranking",
            "Embedding similarity with keyword fallback",
            "Memory and personalization can be disabled",
          ]}
          visual={<MemoryRetrievalVisual />}
          actionLabel="Review memory controls"
          to="/memory"
        />
        <CapabilitySection
          index="04"
          eyebrow="VOICE INTELLIGENCE"
          title="Talk to LORD in the way your device supports."
          body="Voice input uses the browser's speech-recognition interface when available. LORD can display subtitles, play spoken replies, pause during a response, and reconnect for another utterance. Server-side Fish Audio TTS is configured in this environment; playback still depends on provider response, and browser speech synthesis is the fallback."
          points={[
            "Browser speech recognition with text fallback",
            "Subtitles and spoken replies can be toggled",
            "Fish Audio credentials remain server-side",
          ]}
          reverse
          visual={
            <RealScreenshot
              src="/images/experience/voice-assistant.webp"
              alt="Real capture of the LORD Voice Assistant controls and guest session banner"
              label="LIVE VOICE INTERFACE"
            />
          }
          actionLabel="Try Voice demo"
          onAction={() => onOpenGuest("/voice")}
          busy={busy}
        />
        <CapabilitySection
          index="05"
          eyebrow="DEEP RESEARCH"
          title="Gather evidence before writing the report."
          body="The authenticated Deep Research route asks the model to plan a small set of queries, searches Tavily, retrieves accessible pages, deduplicates sources, and synthesizes a saved report. The feature requires server-side OpenRouter and Tavily credentials and is rate-limited; a failed search is surfaced as unavailable or partial."
          points={[
            "Up to three planned queries per research run",
            "Search results and retrieved pages are distinguished",
            "Partial research is labeled rather than presented as complete",
          ]}
          visual={<ResearchFlowVisual />}
          actionLabel="Sign in to explore Research"
          to="/research"
        />
        <CapabilitySection
          index="06"
          eyebrow="MULTIMODAL INPUT"
          title="Bring an image or PDF into the question."
          body="Chat accepts image and PDF attachments when the selected model is marked for vision and the account can use it. The server rejects unsupported model/file combinations and caps a request at four files with a bounded payload. OCR is not enabled as a general chat capability."
          points={[
            "Images and PDFs are passed to compatible models",
            "Vision capability is checked against the model registry",
            "No claim of universal OCR or video understanding",
          ]}
          reverse
          visual={<MultimodalVisual />}
          actionLabel="Try the Chat demo"
          onAction={() => onOpenGuest("/chat")}
          busy={busy}
        />
        <CapabilitySection
          index="07"
          eyebrow="INTELLIGENT TOOLS"
          title="Actions pass through a permission layer."
          body="The LORD agent is a separate Command Center workflow: it plans steps from a registered tool catalog and applies risk and permission checks before execution. Some write actions require explicit confirmation. This is distinct from ordinary chat, whose function-calling flag is currently off."
          points={[
            "Registered browser, files, code, planning and device tools",
            "Risk checks can allow, confirm or deny an action",
            "Connected services may be unavailable until configured",
          ]}
          visual={<PermissionFlowVisual />}
          actionLabel="Sign in to explore Command Center"
          to="/command-center"
        />
        <CapabilitySection
          index="08"
          eyebrow="PERSONALIZATION"
          title="Tune the assistant to your workflow."
          body="Account settings include a default response mode, Fish Audio voice selection, speech speed, auto-speak, and memory and personalization controls. LORD uses those saved preferences where the related feature is active; settings do not guarantee that an external provider is available."
          points={[
            "Default response mode and account-synced voice",
            "Voice speed and auto-speak preferences",
            "Memory and personalization controls",
          ]}
          reverse
          visual={<PreferencesVisual />}
          actionLabel="Explore account settings"
          to="/settings"
        />
      </div>
    </section>
  );
}

function CapabilitySection({
  index,
  eyebrow,
  title,
  body,
  points,
  visual,
  reverse = false,
  actionLabel,
  onAction,
  busy = false,
  to,
}: {
  index: string;
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  visual: ReactNode;
  reverse?: boolean;
  actionLabel: string;
  onAction?: () => void;
  busy?: boolean;
  to?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.article
      className={`intel-capability ${reverse ? "intel-capability-reverse" : ""}`}
      initial={reduced ? false : { opacity: 0, y: 26 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.14 }}
      transition={{ duration: 0.58 }}
    >
      <div className="capability-copy">
        <div className="capability-index">
          <b>{index}</b>
          <span />
          {eyebrow}
        </div>
        <h3>{title}</h3>
        <p>{body}</p>
        <ul>
          {points.map((point) => (
            <li key={point}>
              <Check size={14} /> {point}
            </li>
          ))}
        </ul>
        {onAction ? (
          <button type="button" className="intel-text-action" onClick={onAction} disabled={busy}>
            {busy ? "Opening…" : actionLabel} <ArrowRight size={15} />
          </button>
        ) : (
          <Link to={to as never} className="intel-text-action">
            {actionLabel} <ArrowRight size={15} />
          </Link>
        )}
      </div>
      <div className="capability-visual">{visual}</div>
    </motion.article>
  );
}

function ModelRoutingVisual() {
  const items = [
    "Task + response mode",
    "Registered candidates",
    "Access + capability checks",
    "Stream with bounded fallback",
  ];
  return (
    <div className="model-routing-visual">
      <div className="visual-caption">
        <span /> MODEL ROUTING · SERVER SIDE
      </div>
      {items.map((label, i) => (
        <div className="routing-row" key={label}>
          <span className="routing-count">0{i + 1}</span>
          <span>{label}</span>
          {i < items.length - 1 && <ArrowDown size={13} />}
        </div>
      ))}
      <div className="routing-footer">
        <Layers3 size={14} /> OpenRouter model catalog <span>availability checked</span>
      </div>
    </div>
  );
}

function MemoryRetrievalVisual() {
  return (
    <div className="memory-visual">
      <div className="visual-caption">
        <span /> USER-CONTROLLED CONTEXT
      </div>
      <div className="memory-query">
        <Search size={15} />
        <span>Current question</span>
      </div>
      <div className="memory-rail">
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="memory-results">
        <div>
          <Network size={14} />
          <span>Relevant confirmed memory</span>
          <b>match</b>
        </div>
        <div>
          <FileText size={14} />
          <span>Project knowledge</span>
          <b>scoped</b>
        </div>
        <div>
          <MessageSquareText size={14} />
          <span>Recent conversation</span>
          <b>bounded</b>
        </div>
      </div>
      <div className="memory-controls">
        <ShieldCheck size={14} /> Settings gate retrieval <span>user scoped</span>
      </div>
    </div>
  );
}

function ResearchFlowVisual() {
  return (
    <div className="research-visual">
      <div className="visual-caption">
        <span /> RESEARCH PIPELINE
      </div>
      <div className="research-radar">
        <div className="radar-ring ring-a" />
        <div className="radar-ring ring-b" />
        <div className="radar-center">
          <Search size={22} />
        </div>
        <i />
        <i />
        <i />
      </div>
      <div className="research-source-stack">
        <div>
          <span>01</span> Query plan <Check size={12} />
        </div>
        <div>
          <span>02</span> Tavily search <Check size={12} />
        </div>
        <div>
          <span>03</span> Page retrieval <Activity size={12} />
        </div>
        <div>
          <span>04</span> Synthesis + status <ArrowRight size={12} />
        </div>
      </div>
      <small className="research-footnote">
        Sources can be partial when search or retrieval fails.
      </small>
    </div>
  );
}

function MultimodalVisual() {
  return (
    <div className="multimodal-visual">
      <div className="visual-caption">
        <span /> MODEL-COMPATIBLE INPUT
      </div>
      <div className="multimodal-inputs">
        <div>
          <ImageIcon size={22} />
          <b>Image</b>
          <small>vision-capable model</small>
        </div>
        <div>
          <FileText size={22} />
          <b>PDF</b>
          <small>vision-capable model</small>
        </div>
      </div>
      <div className="multimodal-connector">
        <i />
        <span>validated attachment path</span>
        <i />
      </div>
      <div className="multimodal-output">
        <BrainCircuit size={19} />
        <span>Context-aware answer</span>
        <small>capability + access checked</small>
      </div>
      <div className="multimodal-limit">
        <LockKeyhole size={12} /> Up to 4 supported files per request
      </div>
    </div>
  );
}

function PermissionFlowVisual() {
  return (
    <div className="permission-visual">
      <div className="visual-caption">
        <span /> LORD AGENT · COMMAND CENTER
      </div>
      <div className="permission-stage">
        <span className="permission-icon">
          <Workflow size={19} />
        </span>
        <div>
          <b>Plan steps</b>
          <small>registered tool catalog</small>
        </div>
      </div>
      <div className="permission-line">
        <i />
      </div>
      <div className="permission-decisions">
        <div>
          <Check size={13} />
          <b>Allow</b>
          <small>within policy</small>
        </div>
        <div>
          <CircleHelp size={13} />
          <b>Confirm</b>
          <small>ask the user</small>
        </div>
        <div>
          <LockKeyhole size={13} />
          <b>Deny</b>
          <small>blocked action</small>
        </div>
      </div>
      <div className="permission-foot">
        <ShieldCheck size={13} /> Tool execution and normal chat are separate flows.
      </div>
    </div>
  );
}

function PreferencesVisual() {
  const preferences = [
    { icon: BrainCircuit, name: "Default response mode", value: "Balanced" },
    { icon: AudioLines, name: "Selected voice", value: "Account synced" },
    { icon: Activity, name: "Speech speed", value: "Personal setting" },
    { icon: ShieldCheck, name: "Memory context", value: "User controlled" },
  ];
  return (
    <div className="preferences-visual">
      <div className="visual-caption">
        <span /> ACCOUNT PREFERENCES
      </div>
      {preferences.map(({ icon: Icon, name, value }) => (
        <div className="preferences-row" key={name}>
          <span>
            <Icon size={15} />
          </span>
          <div>
            <b>{name}</b>
            <small>{value}</small>
          </div>
          <span className="preference-switch">
            <i />
          </span>
        </div>
      ))}
      <div className="preferences-note">
        <Settings2 size={13} /> Values reflect saved settings, not provider health.
      </div>
    </div>
  );
}

function LiveExploration({
  active,
  onSelect,
  onOpenGuest,
  busy,
}: {
  active: string;
  onSelect: (id: string) => void;
  onOpenGuest: (path: GuestPath) => void;
  busy: boolean;
}) {
  const options = [
    {
      id: "conversation",
      title: "Ask a question",
      text: "Open the real Chat workspace and submit your own prompt.",
      icon: MessageSquareText,
      path: "/chat" as const,
      action: "Open Chat demo",
    },
    {
      id: "voice",
      title: "Speak with LORD",
      text: "Open Voice and try browser speech input where available.",
      icon: AudioLines,
      path: "/voice" as const,
      action: "Open Voice demo",
    },
    {
      id: "research",
      title: "Explore research",
      text: "Deep Research is account-protected and depends on Tavily and OpenRouter server configuration.",
      icon: Search,
      path: null,
      action: "Sign in to explore",
    },
    {
      id: "tools",
      title: "See permissioned tools",
      text: "Command Center workflows require an account and can ask before actions run.",
      icon: Workflow,
      path: null,
      action: "Sign in to explore",
    },
  ];
  const selected = options.find((option) => option.id === active) ?? options[0];
  return (
    <section className="intel-live-section" id="live-exploration">
      <SectionIntro
        eyebrow="INTERACTIVE EXPLORATION"
        title={
          <>
            See the real flow. <span>No simulated answers.</span>
          </>
        }
        description="Choose an experience to open the existing LORD application. Guest access includes Chat and Voice; research, memory, and tool workflows need an account."
      />
      <div className="live-demo-layout">
        <div className="live-demo-options" role="tablist" aria-label="LORD Intelligence demos">
          {options.map(({ id, title, icon: Icon }) => (
            <button
              role="tab"
              aria-selected={active === id}
              className={active === id ? "active" : ""}
              key={id}
              onClick={() => onSelect(id)}
            >
              <Icon size={17} />
              <span>{title}</span>
              <ChevronRight size={15} />
            </button>
          ))}
        </div>
        <div className="live-demo-detail" role="tabpanel">
          <div className="live-demo-mark">
            <selected.icon size={22} />
            <span>LIVE APPLICATION ROUTE</span>
          </div>
          <h3>{selected.title}</h3>
          <p>{selected.text}</p>
          <div className="live-demo-integrity">
            <Check size={14} /> Opens LORD itself. This page does not fabricate an AI response.
          </div>
          {selected.path ? (
            <button
              className="intel-button intel-button-primary"
              onClick={() => onOpenGuest(selected.path!)}
              disabled={busy}
            >
              {busy ? "Opening…" : selected.action} <ArrowRight size={15} />
            </button>
          ) : (
            <Link className="intel-button intel-button-primary" to="/auth">
              {selected.action} <ArrowRight size={15} />
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

function RealScreenshot({ src, alt, label }: { src: string; alt: string; label: string }) {
  return (
    <figure className="intel-screenshot">
      <figcaption>
        <span className="capture-dot" />
        {label}
        <b>REAL PRODUCT CAPTURE</b>
      </figcaption>
      <img src={src} alt={alt} loading="lazy" decoding="async" />
      <div className="capture-glint" />
    </figure>
  );
}

function SectionIntro({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: ReactNode;
  description: string;
}) {
  return (
    <div className="intel-section-intro">
      <div className="intel-section-eyebrow">{eyebrow}</div>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}

function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 110, damping: 28, mass: 0.2 });
  return <motion.div className="intel-progress" style={{ scaleX }} aria-hidden="true" />;
}

function IntelligenceClosing({ onDemo, busy }: { onDemo: () => void; busy: boolean }) {
  return (
    <section className="intel-closing">
      <div className="closing-orb" aria-hidden="true" />
      <div className="intel-section-eyebrow">INTELLIGENCE WITH INTENTION</div>
      <h2>
        Understand more.
        <br />
        <span>Move with clarity.</span>
      </h2>
      <p>Experience how LORD handles real questions, context and voice in its live application.</p>
      <div className="intel-hero-actions">
        <Link to="/" className="intel-button intel-button-secondary">
          Explore LORD AI <ArrowRight size={15} />
        </Link>
        <button
          className="intel-button intel-button-primary"
          type="button"
          onClick={onDemo}
          disabled={busy}
        >
          {busy ? "Opening demo…" : "Try the live demo"} <ArrowRight size={15} />
        </button>
      </div>
      <div className="intel-final-note">
        <LockKeyhole size={13} /> Results depend on model and provider availability.
      </div>
    </section>
  );
}
