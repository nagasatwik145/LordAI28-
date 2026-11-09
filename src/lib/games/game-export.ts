import JSZip from "jszip";
import { createGameHtml, gameTypeOf, type StoredGameSpec } from "./game-runtime";
import { Game3DSpecSchema } from "./game-spec-3d";
import { THREE_D_CONTROLS } from "./game-controls-3d";

export async function createGameZip(
  input: StoredGameSpec,
  originalPrompt: string,
  runtimeBundle?: string,
): Promise<Blob> {
  const spec = input.schemaVersion === 3 ? Game3DSpecSchema.parse(input) : input;
  const zip = new JSZip();
  if (spec.schemaVersion === 3) {
    const runtime = runtimeBundle ?? (await fetchThreeRuntime());
    zip.file("index.html", createThreeGameHtml(spec));
    zip.file("three-runtime.js", runtime);
  } else {
    zip.file("index.html", createGameHtml(spec));
  }
  zip.file(
    "game.json",
    JSON.stringify(
      {
        ...spec,
        engine: `LORD ${spec.schemaVersion === 3 ? "Three.js 3D" : "2D"} ${gameTypeOf(spec)}`,
        originalPrompt,
        testReport: {
          specificationValidation: "passed",
          automatedGameplayTest: "not_run",
          browserRuntimeTest: "not_run",
        },
        androidApk: {
          status: "unavailable",
          reason: "No configured game-specific Android build and signing pipeline.",
        },
      },
      null,
      2,
    ),
  );
  zip.file(
    "README.md",
    `# ${spec.title}\n\nServe this folder with any static web server, then open index.html in a WebGL-capable browser. ${spec.schemaVersion === 3 ? "The Three.js runtime is bundled locally in three-runtime.js; the game needs no LORD AI session, API key, CDN, or external game assets." : "The game uses a self-contained canvas runtime and has no external asset or network dependencies."}\n\nGame type: ${gameTypeOf(spec)} (${spec.schemaVersion === 3 ? "3D" : "2D"})\n\nObjective: ${spec.schemaVersion === 3 ? spec.objectives.join("; ") : spec.objective}\n\nControls: ${spec.controls.join("; ")}\n\nTest status: specification validated; automated gameplay test not run.\n\nAndroid APK: not included. This archive is a web game package, not an APK.\n`,
  );
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

async function fetchThreeRuntime() {
  if (typeof window === "undefined") throw new Error("The Three.js export runtime is unavailable.");
  const response = await fetch(new URL("/game-export/three-runtime.js", window.location.href));
  if (!response.ok)
    throw new Error(
      "Could not load the bundled Three.js export runtime. Rebuild and deploy the frontend assets.",
    );
  return response.text();
}

function createThreeGameHtml(spec: Extract<StoredGameSpec, { schemaVersion: 3 }>) {
  const data = JSON.stringify(spec).replace(/</g, "\\u003c");
  const escape = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
    );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>${escape(spec.title)}</title><style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#050b16;color:#fff;font:14px system-ui}#game{position:absolute;inset:0 0 72px}canvas{display:block;width:100%;height:100%;touch-action:none}#hud{position:absolute;top:10px;left:12px;right:12px;z-index:2;display:flex;align-items:flex-start;justify-content:space-between;gap:8px;text-shadow:0 2px 7px #000;font-size:${12 * spec.ui.hudScale}px}#report{position:absolute;left:12px;bottom:80px;z-index:2;color:#ffffffa8;font-size:11px}#controls{position:absolute;inset:auto 10px 8px;z-index:3;display:${spec.ui.touchControls ? "flex" : "none"};justify-content:space-between;gap:8px}button{min-height:44px;min-width:48px;border:1px solid #8beaff88;border-radius:12px;background:#07182be8;color:white;font-weight:700;padding:8px 12px;touch-action:none}#error{position:absolute;inset:0;z-index:5;display:grid;align-content:center;justify-items:center;gap:14px;background:#050b16ee;padding:24px;text-align:center}#error[hidden]{display:none}</style></head><body><div id="game"></div><div id="hud"><b>${escape(spec.title)}</b><span id="status">Loading 3D scene…</span><div><button id="pause">Pause</button><button id="restart">Restart</button></div></div><div id="report">Automated gameplay test: not run</div><div id="controls"><div id="move"></div><div id="do"></div></div><div id="error" hidden><span id="errorMessage"></span><button id="retry">Retry loading</button></div><script type="application/json" id="spec">${data}</script><script type="module">
import {mountThreeGame} from './three-runtime.js';
  const spec=JSON.parse(document.querySelector('#spec').textContent),host=document.querySelector('#game'),status=document.querySelector('#status'),error=document.querySelector('#error'),errorMessage=document.querySelector('#errorMessage');let game,paused=false,starting=false;
  const config=${JSON.stringify(THREE_D_CONTROLS)}[spec.gameType];
  const labels={left:'Left',right:'Right',up:'Forward',down:'Back',jump:'Jump',accelerate:'Gas',brake:'Brake',fire:'Fire',punch:'Punch',kick:'Kick',dodge:'Dodge',web:'Web'};
  function addButtons(id,actions){const root=document.querySelector(id);for(const action of actions){const button=document.createElement('button');button.textContent=labels[action];button.addEventListener('pointerdown',event=>{event.preventDefault();button.setPointerCapture(event.pointerId);game?.action(action,true)});for(const name of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(name,()=>game?.action(action,false));root.append(button)}}
  addButtons('#move',config.movement);addButtons('#do',config.actions);
  async function startGame(){if(starting)return;starting=true;error.hidden=true;status.textContent='Loading 3D scene…';try{game=await mountThreeGame(host,spec,value=>{status.textContent=value.status.toUpperCase()+' · '+value.hud})}catch(reason){error.hidden=false;errorMessage.textContent=reason instanceof Error?reason.message:'WebGL preview unavailable'}finally{starting=false}}
  void startGame();
  document.querySelector('#retry').addEventListener('click',()=>void startGame());
  document.querySelector('#pause').addEventListener('click',()=>{paused=!paused;paused?game?.pause():game?.resume();document.querySelector('#pause').textContent=paused?'Resume':'Pause'});document.querySelector('#restart').addEventListener('click',()=>{if(game)game.restart();else void startGame()});
  const keys={ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right',ArrowUp:'up',KeyW:'up',ArrowDown:'down',KeyS:'down',Enter:'accelerate',ShiftLeft:'brake'};
  function actionForKey(code){if(code==='Space')return spec.gameType==='fighting'?'dodge':'jump';if(code==='KeyJ')return spec.gameType==='fighting'?'punch':'fire';if(code==='KeyK')return 'kick';if(code==='KeyL')return 'web';return keys[code]}
  window.addEventListener('keydown',event=>{const action=actionForKey(event.code);if(action){event.preventDefault();game?.action(action,true)}});window.addEventListener('keyup',event=>{const action=actionForKey(event.code);if(action)game?.action(action,false)});
  </script></body></html>`;
}
