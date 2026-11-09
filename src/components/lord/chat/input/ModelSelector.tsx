import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, ChevronDown, Cpu, Crown, Eye, Lock, RefreshCw, Sparkles, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { LORD_MODES, type LordMode } from "@/lib/modes";
import { CHAT_MODEL_CATALOG, FREE_CHAT_MODEL_IDS } from "@/lib/ai/chat-model-catalog";
import { useChatModelCatalog } from "@/lib/ai/use-chat-model-catalog";

interface ModeSelectorProps {
  value: LordMode;
  onChange: (value: LordMode) => void;
}

export function ModeSelector({ value, onChange }: ModeSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const handleSelect = useCallback(
    (mode: LordMode) => {
      onChange(mode);
      setOpen(false);
    },
    [onChange],
  );

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const selected = LORD_MODES.find((m) => m.id === value) ?? LORD_MODES[1];
  const SelectedIcon = selected.icon;

  return (
    <div className="relative" ref={ref}>
      <motion.button
        type="button"
        onClick={() => setOpen(!open)}
        whileTap={{ scale: 0.96 }}
        className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white/80 backdrop-blur transition hover:border-cyan-400/40 hover:text-cyan-200"
        aria-label="Select mode"
      >
        <SelectedIcon className="h-3.5 w-3.5 text-cyan-300" />
        <span className="font-medium">{selected.label}</span>
        <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className="absolute right-0 top-full z-50 mt-2 w-52 overflow-hidden rounded-2xl border border-white/10 bg-[rgba(18,20,28,0.92)] p-1 shadow-[0_20px_60px_rgba(0,0,0,0.6)] backdrop-blur-2xl"
          >
            {LORD_MODES.map((m) => {
              const active = m.id === value;
              const Icon = m.icon;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => handleSelect(m.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition",
                    active
                      ? "bg-cyan-400/10 text-cyan-200"
                      : "text-white/70 hover:bg-white/5 hover:text-white",
                  )}
                >
                  <Icon className="h-4 w-4 text-cyan-300" />
                  <span className="flex flex-col">
                    <span className="text-sm font-medium">{m.label}</span>
                    <span className="text-[10px] text-white/40">{m.description}</span>
                  </span>
                  {active && <Check className="ml-auto h-4 w-4 text-cyan-300" />}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface ModelSelectorProps {
  value: string;
  onChange: (value: string) => void;
  enabled?: boolean;
}

export function ModelSelector({ value, onChange, enabled = true }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const catalogQuery = useChatModelCatalog({ enabled });
  const models =
    catalogQuery.data?.models ??
    CHAT_MODEL_CATALOG.map((model) => {
      const isGuestFreeModel =
        !enabled && FREE_CHAT_MODEL_IDS.some((freeModelId) => freeModelId === model.id);
      return {
        ...model,
        available: isGuestFreeModel,
        providerStatus: isGuestFreeModel
          ? ("available" as const)
          : catalogQuery.isPending && enabled
            ? ("checking" as const)
            : ("unavailable" as const),
        unavailableReason: isGuestFreeModel
          ? undefined
          : !enabled
            ? "Sign in to check provider availability for this model."
            : catalogQuery.isPending
              ? "Checking provider availability…"
              : "Availability could not be loaded. Retry the check.",
      };
    });
  const isPro = catalogQuery.data?.isPro ?? false;
  const selected = models.find((model) => model.id === value) ?? models[0] ?? CHAT_MODEL_CATALOG[0];

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <motion.button
        type="button"
        onClick={() => setOpen((current) => !current)}
        whileTap={{ scale: 0.96 }}
        className="flex max-w-52 items-center gap-1.5 rounded-full border border-cyan-400/20 bg-cyan-400/5 px-2.5 py-1.5 text-xs text-white/80 backdrop-blur transition hover:border-cyan-400/40 hover:text-cyan-200"
        aria-label={`Select AI model, current model ${selected.label}`}
        aria-expanded={open}
      >
        <Cpu className="h-3.5 w-3.5 shrink-0 text-cyan-300" />
        <span className="truncate font-medium">{selected.label}</span>
        <ChevronDown
          className={cn("h-3 w-3 shrink-0 transition-transform", open && "rotate-180")}
        />
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className="absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-white/10 bg-[rgba(18,20,28,0.97)] p-2 shadow-[0_20px_60px_rgba(0,0,0,0.6)] backdrop-blur-2xl"
          >
            <div className="border-b border-white/10 px-2 pb-2">
              <div className="flex items-center justify-between text-xs font-semibold text-white">
                <span>Choose a model</span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px]",
                    isPro ? "bg-cyan-300/10 text-cyan-200" : "bg-emerald-400/10 text-emerald-300",
                  )}
                >
                  {isPro ? "LORD Pro" : "Free tier · 2 models"}
                </span>
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-white/45">
                North Mini Code and Gemma 3 27B IT are included free.
                {enabled
                  ? " Provider availability is checked live."
                  : " Sign in to check live provider availability."}
              </p>
              {enabled && catalogQuery.isError && (
                <button
                  type="button"
                  onClick={() => void catalogQuery.retryAvailability().catch(() => {})}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-md text-[10px] font-medium text-cyan-200 hover:text-cyan-100"
                >
                  <RefreshCw className="h-3 w-3" /> Retry model availability
                </button>
              )}
              {enabled && catalogQuery.isPending && (
                <p className="mt-2 text-[10px] text-white/45">Checking provider access…</p>
              )}
            </div>
            <div className="mt-1 max-h-[min(55vh,25rem)] overflow-y-auto">
              {models.map((model) => {
                const active = model.id === selected.id;
                const locked = model.proOnly && !isPro;
                const canSelect = model.available && !locked;
                const providerState = model.providerStatus;
                return (
                  <button
                    key={model.id}
                    type="button"
                    disabled={catalogQuery.isFetching}
                    title={
                      model.available
                        ? locked
                          ? "Available from OpenRouter; upgrade to select it"
                          : "Available"
                        : `${model.unavailableReason ?? "Unavailable"} Click to retry.`
                    }
                    onClick={() => {
                      if (!enabled) {
                        if (FREE_CHAT_MODEL_IDS.some((freeModelId) => freeModelId === model.id)) {
                          onChange(model.id);
                          setOpen(false);
                        }
                        return;
                      }
                      if (!model.available) {
                        void catalogQuery.retryAvailability().catch(() => {});
                        return;
                      }
                      if (locked) {
                        window.location.assign("/upgrade");
                        return;
                      }
                      if (!model.available) return;
                      onChange(model.id);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left transition",
                      active
                        ? "bg-cyan-400/10 text-cyan-100"
                        : model.available
                          ? "text-white/75 hover:bg-white/5 hover:text-white"
                          : "cursor-not-allowed text-white/35",
                    )}
                  >
                    {locked ? (
                      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-200" />
                    ) : (
                      <Cpu className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-300" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-medium">{model.label}</span>
                        {locked && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-300/10 px-1.5 py-0.5 text-[9px] font-semibold text-amber-200">
                            <Crown className="h-2.5 w-2.5" />
                            PRO
                          </span>
                        )}
                        {!model.available && providerState !== "checking" && (
                          <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[9px] text-white/45">
                            {providerState === "missing_credentials"
                              ? "Not configured"
                              : providerState === "invalid_credentials"
                                ? "Auth error"
                                : providerState === "insufficient_credits"
                                  ? "No credits"
                                  : providerState === "unsupported_model"
                                    ? "Unsupported"
                                    : providerState === "rate_limited"
                                      ? "Rate limited"
                                      : providerState === "timeout"
                                        ? "Timed out"
                                        : providerState === "malformed_response"
                                          ? "Invalid response"
                                          : "Unavailable"}
                          </span>
                        )}
                        {model.vision && (
                          <Eye className="h-3 w-3 shrink-0 text-violet-300" aria-label="Vision" />
                        )}
                        {model.reasoning && (
                          <Sparkles
                            className="h-3 w-3 shrink-0 text-amber-300"
                            aria-label="Reasoning"
                          />
                        )}
                        {model.coding && (
                          <Zap className="h-3 w-3 shrink-0 text-sky-300" aria-label="Coding" />
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-[10px] text-white/40">
                        {model.providerLabel} · {model.capabilities}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-white/40">
                        {!model.available
                          ? `${model.unavailableReason ?? "Unavailable"} · click to retry`
                          : locked
                            ? "Available from provider · upgrade to select"
                            : "Available on your plan"}
                      </span>
                    </span>
                    {!model.available && (
                      <RefreshCw
                        className={cn(
                          "mt-0.5 h-3.5 w-3.5 shrink-0",
                          catalogQuery.isFetching ? "animate-spin text-cyan-200" : "text-white/45",
                        )}
                        aria-label={`Retry availability check for ${model.label}`}
                      />
                    )}
                    {active && canSelect && (
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-300" />
                    )}
                  </button>
                );
              })}
            </div>
            <div className="border-t border-white/10 px-2 pt-2 text-[10px] leading-relaxed text-white/55">
              Provider availability is independent of your plan. LORD Pro unlocks the other
              configured models, voice, 3D games, and Fast Reply Mode.
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
