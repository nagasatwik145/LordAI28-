import { useEffect, useRef, useState } from "react";
import {
  mountThreeGame,
  type Game3DAction,
  type Game3DHandle,
  type Game3DStatus,
  type GraphicsQuality,
} from "./runtime";
import { parseGame3DSpecForPreview, type Game3DSpec } from "../../game-spec-3d";
import { canSelectFightingSuit, type FightingProgress } from "./fighting";
import { THREE_D_CONTROLS } from "../../game-controls-3d";

export function ThreeGamePreview({ spec: input }: { spec: unknown }) {
  const parsed = parseGame3DSpecForPreview(input);
  if ("error" in parsed) {
    return (
      <div
        role="alert"
        className="grid aspect-video min-h-[300px] w-full place-items-center rounded-2xl border border-rose-300/20 bg-slate-950 p-6 text-center text-sm text-rose-100"
      >
        <div>
          <strong className="block text-base">This 3D game cannot be opened</strong>
          <span className="mt-2 block text-white/70">{parsed.error}</span>
        </div>
      </div>
    );
  }
  return <PlayableThreeGamePreview spec={parsed.spec} />;
}

function PlayableThreeGamePreview({ spec }: { spec: Game3DSpec }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<Game3DHandle | null>(null);
  const [state, setState] = useState<Game3DStatus>({ status: "ready", hud: "Loading 3D scene…" });
  const [error, setError] = useState("");
  const [restartToken, setRestartToken] = useState(0);
  const [quality, setQuality] = useState<GraphicsQuality>("medium");
  const [fightingProgress, setFightingProgress] = useState<FightingProgress | undefined>();
  const fightingProgressRef = useRef<FightingProgress | undefined>(undefined);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let mounted = true;
    setError("");
    setState({ status: "ready", hud: "Loading Three.js scene…" });
    mountThreeGame(
      host,
      spec,
      (next) => {
        if (!mounted) return;
        setState(next);
        if (next.fightingProgress) {
          fightingProgressRef.current = next.fightingProgress;
          setFightingProgress(next.fightingProgress);
        }
      },
      "medium",
      fightingProgressRef.current,
    )
      .then((handle) => {
        if (!mounted) {
          handle.dispose();
          return;
        }
        handleRef.current = handle;
      })
      .catch((reason: unknown) => {
        if (!mounted) return;
        const message = reason instanceof Error ? reason.message : "The 3D game could not start.";
        setError(message);
        setState({ status: "failed", hud: "3D preview unavailable" });
      });
    return () => {
      mounted = false;
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, [spec, restartToken]);

  const label = (action: Game3DAction) =>
    ({
      left: "Left",
      right: "Right",
      jump: "Jump",
      accelerate: "Gas",
      brake: "Brake",
      up: "Forward",
      down: "Back",
      fire: "Fire",
      punch: "Punch",
      kick: "Kick",
      dodge: "Dodge",
      web: "Web",
    })[action];
  const selectSuit = (suitKey: string) => {
    if (
      spec.gameType !== "fighting" ||
      !fightingProgress ||
      !canSelectFightingSuit(spec, fightingProgress.wins, suitKey)
    )
      return;
    handleRef.current?.setSuit(suitKey);
    const next = { ...fightingProgress, selectedSuitKey: suitKey };
    fightingProgressRef.current = next;
    setFightingProgress(next);
  };
  return (
    <>
      <div className="group relative aspect-video min-h-[300px] w-full overflow-hidden rounded-2xl border border-white/10 bg-[#050b16] shadow-[0_24px_80px_-32px_rgba(0,0,0,.8)] sm:aspect-[16/10]">
        <div ref={hostRef} className="absolute inset-0" />
        <div
          style={{ fontSize: `${12 * spec.ui.hudScale}px` }}
          className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 bg-gradient-to-b from-black/75 via-black/25 to-transparent px-3 pb-8 pt-3 text-xs text-white sm:px-5"
        >
          <div className="min-w-0">
            <span className="block truncate text-sm font-bold tracking-wide sm:text-base">
              {spec.title}
            </span>
            <span className="block truncate text-[11px] text-white/65">
              {spec.world} · {spec.objective}
            </span>
          </div>
          <span
            aria-live="polite"
            className="max-w-[58%] shrink-0 rounded-full border border-white/15 bg-black/55 px-2.5 py-1.5 text-[10px] tabular-nums sm:text-xs"
          >
            {state.hud}
          </span>
        </div>
        <div className="absolute right-2 top-[4.2rem] flex items-center gap-1.5 sm:right-4">
          <label className="rounded-lg border border-white/15 bg-slate-950/75 px-2 py-1.5 text-[10px] text-white/80">
            Graphics{" "}
            <select
              aria-label="Graphics quality"
              className="ml-1 bg-transparent font-semibold text-white outline-none"
              value={quality}
              onChange={(event) => {
                const next = event.target.value as GraphicsQuality;
                setQuality(next);
                handleRef.current?.setQuality(next);
              }}
            >
              <option className="bg-slate-950" value="low">
                Low
              </option>
              <option className="bg-slate-950" value="medium">
                Medium
              </option>
              <option className="bg-slate-950" value="high">
                High
              </option>
            </select>
          </label>
          <button
            className="rounded-lg border border-white/20 bg-slate-950/75 px-2.5 py-1.5 text-xs text-white"
            onClick={() =>
              state.status === "paused" ? handleRef.current?.resume() : handleRef.current?.pause()
            }
            disabled={!!error || !!state.error}
          >
            {state.status === "paused" ? "Resume" : "Pause"}
          </button>
          <button
            className="rounded-lg border border-cyan-200/40 bg-slate-950/75 px-2.5 py-1.5 text-xs text-cyan-100"
            onClick={() => setRestartToken((value) => value + 1)}
          >
            Restart
          </button>
          <button
            aria-label="Enter fullscreen"
            className="hidden rounded-lg border border-white/20 bg-slate-950/75 px-2.5 py-1.5 text-xs text-white sm:block"
            onClick={() => {
              const frame = hostRef.current?.parentElement;
              if (frame && !document.fullscreenElement) void frame.requestFullscreen();
              else if (document.fullscreenElement) void document.exitFullscreen();
            }}
          >
            ⛶
          </button>
        </div>
        {spec.gameType === "fighting" && fightingProgress && (
          <div className="absolute left-3 top-[4.2rem] z-10 max-w-[70%] text-white sm:left-5">
            <div className="rounded-xl border border-white/15 bg-slate-950/80 px-2.5 py-1.5 text-[11px] font-semibold shadow-lg">
              Fight {state.battle ?? 1}/{state.battleCount ?? spec.mechanics.battleCount} ·
              Victories {fightingProgress.wins}
            </div>
            <details className="mt-1 rounded-xl border border-white/15 bg-slate-950/85 p-2 text-xs shadow-lg">
              <summary className="cursor-pointer">
                Suit:{" "}
                {spec.suits.find((suit) => suit.key === fightingProgress.selectedSuitKey)?.name ??
                  spec.suits[0].name}
              </summary>
              <div className="mt-2 grid gap-1">
                {spec.suits.map((suit) => {
                  const unlocked = canSelectFightingSuit(spec, fightingProgress.wins, suit.key);
                  return (
                    <button
                      key={suit.key}
                      type="button"
                      disabled={!unlocked}
                      onClick={() => selectSuit(suit.key)}
                      className={`rounded-lg px-2 py-1.5 text-left ${unlocked ? "bg-cyan-900/70 text-cyan-50" : "cursor-not-allowed bg-slate-800/90 text-white/45"}`}
                    >
                      {unlocked ? "✓" : "🔒"} {suit.name}
                      {!unlocked
                        ? ` · after ${spec.suits.indexOf(suit) * spec.mechanics.suitUnlockEvery} wins`
                        : ""}
                    </button>
                  );
                })}
              </div>
            </details>
          </div>
        )}
        {state.status === "ready" && !error && (
          <div
            role="status"
            className="absolute left-1/2 top-1/2 -translate-x-1/2 rounded-xl bg-slate-950/85 px-4 py-2 text-sm text-cyan-100"
          >
            Initializing WebGL…
          </div>
        )}
        {(error || state.error) && (
          <div
            role="alert"
            className="absolute inset-0 grid place-items-center bg-slate-950/90 p-5 text-center text-sm text-rose-100"
          >
            {error || state.error}
          </div>
        )}
        {(state.status === "completed" || state.status === "failed" || state.status === "paused") &&
          !error && (
            <div className="pointer-events-none absolute left-1/2 top-[42%] -translate-x-1/2 rounded-2xl border border-white/15 bg-slate-950/75 px-5 py-3 text-center text-sm font-bold text-white shadow-xl backdrop-blur">
              <span className="block text-[10px] font-semibold uppercase tracking-[.24em] text-cyan-200">
                {state.status === "completed"
                  ? "Mission complete"
                  : state.status === "failed"
                    ? "Run over"
                    : "Paused"}
              </span>
              <span className="mt-1 block">
                {state.status === "completed"
                  ? spec.winCondition
                  : state.status === "failed"
                    ? spec.loseCondition
                    : "Take a breath. Your game is paused."}
              </span>
            </div>
          )}
        <div className="pointer-events-none absolute bottom-3 left-1/2 hidden -translate-x-1/2 rounded-full border border-white/10 bg-slate-950/55 px-3 py-1 text-[10px] text-white/70 backdrop-blur sm:block">
          {spec.controls.join(" · ")}
        </div>
        {!error && !state.error && spec.ui.touchControls && (
          <div
            className="absolute inset-x-0 bottom-2 flex flex-wrap items-end justify-between gap-2 px-2 sm:px-4"
            aria-label="Touch game controls"
          >
            <div className="flex gap-2">
              {THREE_D_CONTROLS[spec.gameType].movement.map((action) => (
                <TouchButton
                  key={action}
                  action={action}
                  label={label(action)}
                  setAction={(value, pressed) => handleRef.current?.action(value, pressed)}
                />
              ))}
            </div>
            <div className="flex gap-2">
              {THREE_D_CONTROLS[spec.gameType].actions.map((action) => (
                <TouchButton
                  key={action}
                  action={action}
                  label={label(action)}
                  setAction={(value, pressed) => handleRef.current?.action(value, pressed)}
                  strong
                />
              ))}
            </div>
          </div>
        )}
      </div>
      <p role="status" className="px-1 pt-2 text-xs text-slate-400">
        Specification validation: passed · Automated gameplay test: not run · Runtime:{" "}
        {error ? "failed" : state.status}
      </p>
    </>
  );
}

function TouchButton({
  action,
  label,
  strong,
  setAction,
}: {
  action: Game3DAction;
  label: string;
  strong?: boolean;
  setAction: (action: Game3DAction, pressed: boolean) => void;
}) {
  return (
    <button
      aria-label={label}
      className={`min-h-11 min-w-12 rounded-xl border px-3 text-xs font-bold text-white shadow-lg ${strong ? "border-cyan-100/50 bg-cyan-600/75" : "border-white/30 bg-slate-900/75"}`}
      style={{ touchAction: "none" }}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        setAction(action, true);
      }}
      onPointerUp={() => setAction(action, false)}
      onPointerCancel={() => setAction(action, false)}
      onLostPointerCapture={() => setAction(action, false)}
    >
      {label}
    </button>
  );
}
