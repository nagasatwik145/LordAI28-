import { z } from "zod";
import { Game3DSpecSchema, type Game3DSpec } from "./game-spec-3d";

const base = {
  schemaVersion: z.literal(2),
  title: z.string().trim().min(1).max(60),
  description: z.string().trim().min(1).max(300),
  gameType: z.enum(["runner", "rally", "platformer", "shooter", "puzzle"]),
  theme: z.string().trim().min(1).max(80),
  player: z.string().trim().min(1).max(80),
  world: z.string().trim().min(1).max(120),
  difficulty: z.enum(["easy", "normal", "hard"]),
  objective: z.string().trim().min(1).max(140),
  controls: z.array(z.string().trim().min(1).max(60)).min(1).max(8),
  visualStyle: z.string().trim().min(1).max(120),
  winCondition: z.string().trim().min(1).max(120),
  loseCondition: z.string().trim().min(1).max(120),
  seed: z.number().int().min(0).max(2_147_483_647),
};

export const GameSpecSchema = z.discriminatedUnion("gameType", [
  z
    .object({
      ...base,
      gameType: z.literal("runner"),
      mechanics: z
        .object({
          obstacleDensity: z.number().min(0.5).max(2),
          collectibleDensity: z.number().min(0.2).max(2),
          jumpHeight: z.number().min(0.7).max(1.4),
          finishDistance: z.number().min(80).max(240),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      gameType: z.literal("rally"),
      mechanics: z
        .object({
          fuelCapacity: z.number().min(50).max(200),
          fuelDrain: z.number().min(0.1).max(1),
          rockDensity: z.number().min(0.4).max(2),
          fuelPickupRate: z.number().min(0.3).max(2),
          finishDistance: z.number().min(80).max(240),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      gameType: z.literal("platformer"),
      mechanics: z
        .object({
          platformCount: z.number().int().min(5).max(16),
          hazardCount: z.number().int().min(1).max(8),
          collectibleCount: z.number().int().min(2).max(12),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      gameType: z.literal("shooter"),
      mechanics: z
        .object({
          fireRate: z.number().min(0.12).max(0.8),
          enemyDensity: z.number().min(0.3).max(2),
          playerSpeed: z.number().min(2).max(8),
          targetKills: z.number().int().min(8).max(20),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      gameType: z.literal("puzzle"),
      mechanics: z
        .object({
          gridSize: z.number().int().min(5).max(8),
          colorCount: z.number().int().min(3).max(6),
          matchLength: z.number().int().min(3).max(4),
          targetMatches: z.number().int().min(3).max(12),
        })
        .strict(),
    })
    .strict(),
]);

export type GameSpec = z.infer<typeof GameSpecSchema>;
export type LegacyGameSpec = {
  schemaVersion: 1;
  title: string;
  description: string;
  genre: "runner" | "dodge";
  theme: string;
  difficulty: "easy" | "normal" | "hard";
  objective: string;
  controls: string[];
  seed: number;
};
export type StoredGameSpec = GameSpec | Game3DSpec | LegacyGameSpec;
export type GeneratedGameSpec = GameSpec | Game3DSpec;
export type GameType = GameSpec["gameType"] | Game3DSpec["gameType"];

export function validateGameSpec(value: unknown): value is StoredGameSpec {
  if (GameSpecSchema.safeParse(value).success) return true;
  if (Game3DSpecSchema.safeParse(value).success) return true;
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.schemaVersion === 1 &&
    typeof v.title === "string" &&
    v.title.length <= 80 &&
    typeof v.description === "string" &&
    v.description.length <= 300 &&
    ["runner", "dodge"].includes(String(v.genre)) &&
    typeof v.theme === "string" &&
    ["easy", "normal", "hard"].includes(String(v.difficulty)) &&
    typeof v.objective === "string" &&
    Array.isArray(v.controls) &&
    v.controls.length <= 8 &&
    typeof v.seed === "number"
  );
}

export function gameTypeOf(spec: StoredGameSpec): GameType {
  if (spec.schemaVersion === 2 || spec.schemaVersion === 3) return spec.gameType;
  return "runner";
}

export function getRendererName(
  spec: StoredGameSpec,
): GameType | `three-${Game3DSpec["gameType"]}` {
  return spec.schemaVersion === 3 ? `three-${spec.gameType}` : gameTypeOf(spec);
}

export function upgradeLegacyGameSpec(spec: LegacyGameSpec): GameSpec {
  return GameSpecSchema.parse({
    schemaVersion: 2,
    title: spec.title.slice(0, 60),
    description: spec.description,
    gameType: "runner",
    theme: spec.theme,
    player: "A nimble runner",
    world: "A scrolling course with obstacles and collectibles",
    difficulty: spec.difficulty,
    objective: spec.objective,
    controls: spec.controls.length ? spec.controls : ["Space or tap to jump"],
    visualStyle: spec.theme,
    winCondition: "Run as far as possible and collect items",
    loseCondition: "Collide with an obstacle",
    seed: Math.abs(Math.trunc(spec.seed)) % 2_147_483_647,
    mechanics: { obstacleDensity: 1, collectibleDensity: 1, jumpHeight: 1, finishDistance: 160 },
  });
}

/** Fixed, reviewed runtime: the validated spec selects a distinct deterministic engine. */
export function createGameHtml(spec: StoredGameSpec): string {
  if (spec.schemaVersion === 3)
    throw new Error("Three-dimensional games must be rendered by the Three.js preview engine.");
  const data = JSON.stringify(spec).replace(/</g, "\\u003c");
  const renderer = getRendererName(spec);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>${escapeHtml(spec.title)}</title><style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#07111f;color:#eaf8ff;font:14px system-ui}canvas{display:block;width:100%;height:100%;touch-action:none}#hud{position:absolute;inset:12px 14px auto;display:flex;justify-content:space-between;gap:12px;pointer-events:none;text-shadow:0 2px 8px #000}#message{position:absolute;inset:0;display:grid;place-items:center;text-align:center;background:#07111fcc}#message[hidden]{display:none}button{border:1px solid #29dfff;background:#092638;color:white;border-radius:12px;padding:12px 18px;font-weight:700;font-size:16px}small{opacity:.75}</style></head><body><canvas id="game"></canvas><div id="hud"><b id="name"></b><b id="meter"></b></div><div id="message"><div><h2 id="headline">Ready</h2><p id="help"></p><button id="start">Play</button><p><small id="controls"></small></p></div></div><script>const G=${data},ENGINE=${JSON.stringify(renderer)};
const c=document.querySelector('#game'),ctx=c.getContext('2d'),overlay=document.querySelector('#message'),meter=document.querySelector('#meter');
document.querySelector('#name').textContent=G.title;document.querySelector('#help').textContent=G.objective+' · '+(G.visualStyle||'classic pixel art')+' · '+(G.world||G.theme);document.querySelector('#controls').textContent=G.controls.join(' · ');
let w=0,h=0,dpr=1,active=false,ended=false,score=0,last=0,keys={},state={},frame=0;
const styleHash=Array.from(G.visualStyle||G.theme||'').reduce((n,ch)=>n+ch.charCodeAt(0),0);const accent='hsl('+(styleHash%360)+' 82% 66%)';
const colors=[accent,'#ffd166','#ff6688','#a78bfa','#65f0a4','#ff965e'];
function resize(){dpr=Math.min(devicePixelRatio||1,2);w=c.clientWidth;h=c.clientHeight;c.width=w*dpr;c.height=h*dpr;ctx.setTransform(dpr,0,0,dpr,0,0)}new ResizeObserver(resize).observe(c);resize();
function rng(){let x=G.seed||1;x^=x<<13;x^=x>>>17;x^=x<<5;G.seed=x>>>0;return G.seed/4294967295}
function show(text,won=false){active=false;ended=true;overlay.hidden=false;document.querySelector('#headline').textContent=(won?(G.winCondition||'Level complete'):(G.loseCondition||'Game over'))+' · '+text;document.querySelector('#start').textContent=won?'Play again':'Try again'}
function start(){score=0;frame=0;ended=false;active=true;overlay.hidden=true;last=performance.now();state=initialState();requestAnimationFrame(loop)}
function initialState(){switch(ENGINE){case'rally':return{car:.5,fuel:G.mechanics.fuelCapacity,items:[],spawn:0};case'platformer':return{px:40,py:0,vy:0,camera:0,coins:0,ground:false,world:makePlatforms()};case'shooter':return{px:.5,py:.78,shots:[],enemies:[],stars:[],spawn:0,lastShot:0,kills:0};case'puzzle':return puzzleStart();default:return{py:.7,vy:0,items:[],spawn:0,distance:0}}}
function button(x,y,r,color){ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill()}
function back(){let hue=styleHash%360,g=ctx.createLinearGradient(0,0,w,h);g.addColorStop(0,'hsl('+hue+' 48% 14%)');g.addColorStop(1,'hsl('+((hue+70)%360)+' 50% 10%)');ctx.fillStyle=g;ctx.fillRect(0,0,w,h)}
function floor(){ctx.fillStyle='#17324b';ctx.fillRect(0,h*.82,w,h*.18);ctx.fillStyle='#28dfff';ctx.fillRect(0,h*.82,w,3)}
function loop(now){if(!active)return;const dt=Math.min((now-last)/16,2);last=now;frame++;back();switch(ENGINE){case'rally':tickRally(dt);break;case'platformer':tickPlatformer(dt);break;case'shooter':tickShooter(dt,now);break;case'puzzle':drawPuzzle();break;default:tickRunner(dt)}if(active)requestAnimationFrame(loop)}
function hud(label){meter.textContent=label}
function tickRunner(dt){floor();const p=state;p.spawn-=dt;const density=G.schemaVersion===2?G.mechanics.obstacleDensity:1,coinRate=G.schemaVersion===2?Math.min(.9,.4*G.mechanics.collectibleDensity):.55;if(p.spawn<=0){p.items.push({x:w+20,y:h*.82-28,coin:rng()<coinRate});p.spawn=Math.max(32,80-(score/20))/density}const speed=(G.difficulty==='hard'?6:G.difficulty==='easy'?3.5:4.7);for(const o of p.items)o.x-=speed*dt;p.vy+=.58*dt;p.py=Math.min(.74,p.py+p.vy*dt);if(p.py>=.74)p.vy=0;if(keys.Space||keys.ArrowUp||keys.KeyW){if(p.py>=.739)p.vy=-(G.schemaVersion===2?G.mechanics.jumpHeight:1)*.026;keys.Space=keys.ArrowUp=keys.KeyW=false}const py=h*p.py;ctx.fillStyle=accent;ctx.fillRect(w*.18,py-34,30,34);for(const o of p.items){if(o.coin){button(o.x,o.y,9,'#ffd166');if(Math.abs(o.x-w*.18-15)<22&&Math.abs(o.y-py)<34){o.x=-30;score+=10}}else{ctx.fillStyle='#ff5478';ctx.fillRect(o.x,o.y,24,30);if(o.x<w*.18+30&&o.x+24>w*.18&&py>o.y-28)show('Game over · '+score)}}p.items=p.items.filter(o=>o.x>-30);score+=dt;p.distance+=dt;if(G.schemaVersion===2&&p.distance>=G.mechanics.finishDistance)show('Finish line reached · '+Math.floor(score),true);hud('Distance '+Math.floor(p.distance)+' · Score '+Math.floor(score))}
function tickRally(dt){floor();const p=state;const speed=G.difficulty==='hard'?6:4.5;let steer=(keys.ArrowLeft||keys.KeyA?-1:0)+(keys.ArrowRight||keys.KeyD?1:0);p.car=Math.max(.12,Math.min(.88,p.car+steer*.009*dt));p.fuel-=G.mechanics.fuelDrain*dt;p.spawn-=dt;if(p.spawn<=0){const fuel=rng()<Math.min(.85,.4*G.mechanics.fuelPickupRate);p.items.push({x:rng()*.65+.17,y:-20,fuel});p.spawn=fuel?90/G.mechanics.fuelPickupRate:48/G.mechanics.rockDensity}const roadX=w*.12,roadW=w*.76;ctx.fillStyle='#473b32';ctx.fillRect(roadX,0,roadW,h*.83);ctx.fillStyle='#d7b56d';ctx.fillRect(roadX,0,4,h*.83);ctx.fillRect(roadX+roadW-4,0,4,h*.83);for(let i=0;i<6;i++){ctx.fillStyle='#d2c18a';ctx.fillRect(w*.495,(i*90+frame*speed*2)%h,5,38)}for(const o of p.items){o.y+=speed*dt;if(o.fuel){button(o.x*w,o.y,10,'#64efab');if(o.y>h*.68&&o.y<h*.83&&Math.abs(o.x-p.car)<.11){p.fuel=Math.min(G.mechanics.fuelCapacity,p.fuel+24);o.y=h+50;score+=30}}else{ctx.fillStyle='#8d8075';ctx.beginPath();ctx.moveTo(o.x*w,o.y-15);ctx.lineTo(o.x*w+13,o.y+10);ctx.lineTo(o.x*w-14,o.y+10);ctx.fill();if(o.y>h*.68&&o.y<h*.83&&Math.abs(o.x-p.car)<.09)show('Rally over · rock collision · '+Math.floor(score))}}p.items=p.items.filter(o=>o.y<h+30);ctx.fillStyle=accent;ctx.fillRect(p.car*w-17,h*.69,34,48);ctx.fillStyle='#131d2c';ctx.fillRect(p.car*w-21,h*.72,6,13);ctx.fillRect(p.car*w+15,h*.72,6,13);score+=dt*.6;if(p.fuel<=0)show('Out of fuel · '+Math.floor(score));if(score>=G.mechanics.finishDistance)show('Rally finished!',true);hud('Fuel '+Math.max(0,Math.floor(p.fuel))+' · '+Math.floor(score)+' km')}
function makePlatforms(){const n=G.mechanics.platformCount,arr=[];for(let i=0;i<n;i++)arr.push({x:80+i*150,y:h*(.67-(i%3)*.13),coin:i<G.mechanics.collectibleCount,hazard:i<G.mechanics.hazardCount});return arr}
function tickPlatformer(dt){const p=state,world=p.world;const speed=G.difficulty==='hard'?4.2:3.3;const moving=keys.ArrowRight||keys.KeyD;const backMove=keys.ArrowLeft||keys.KeyA;if(moving)p.px+=speed*dt;if(backMove)p.px=Math.max(0,p.px-speed*dt);if((keys.Space||keys.ArrowUp||keys.KeyW)&&p.ground){p.vy=-11;keys.Space=keys.ArrowUp=keys.KeyW=false;p.ground=false}p.vy+=.48*dt;p.py+=p.vy*dt;const wx=p.px+p.camera;const plat=world.find(q=>wx+24>q.x&&wx<q.x+90&&p.py+28>=q.y&&p.py+28<=q.y+18&&p.vy>=0);if(plat){p.py=plat.y-28;p.vy=0;p.ground=true}else if(p.py>h*.78-28){p.py=h*.78-28;p.vy=0;p.ground=true}if(wx> w*.45)p.camera+=speed*dt;floor();for(const q of world){const sx=q.x-p.camera;if(sx<-100||sx>w+100)continue;ctx.fillStyle='#6b513b';ctx.fillRect(sx,q.y,90,16);ctx.fillStyle='#55a85e';ctx.fillRect(sx,q.y,90,5);if(q.coin&&!q.got){button(sx+45,q.y-19,8,'#ffd166');if(Math.abs(wx-(q.x+45))<22&&Math.abs(p.py+10-q.y)<36){q.got=true;p.coins++;score+=15}}if(q.hazard){ctx.fillStyle='#ef5668';ctx.beginPath();ctx.moveTo(sx+34,q.y);ctx.lineTo(sx+45,q.y-20);ctx.lineTo(sx+56,q.y);ctx.fill();if(wx+23>q.x+34&&wx<q.x+56&&p.py+28>q.y-20&&p.py+28<q.y+14)show('Temple escape ended · '+score)}}ctx.fillStyle=accent;ctx.fillRect(p.px-p.camera,h*.78-28,25,28);const finish=world[world.length-1].x+125;ctx.fillStyle='#ffd166';ctx.fillRect(finish-p.camera,h*.48,8,h*.3);if(wx>=finish)show('Treasure reached!',true);score+=dt*.1;hud('Relics '+p.coins+' · '+Math.floor(score))}
function tickShooter(dt,now){const p=state;const speed=G.mechanics.playerSpeed;const dx=(keys.ArrowRight||keys.KeyD?1:0)-(keys.ArrowLeft||keys.KeyA?1:0),dy=(keys.ArrowDown||keys.KeyS?1:0)-(keys.ArrowUp||keys.KeyW?1:0);p.px=Math.max(.05,Math.min(.95,p.px+dx*speed*.001*dt));p.py=Math.max(.1,Math.min(.82,p.py+dy*speed*.001*dt));if((keys.Space||keys.KeyJ)&&now-p.lastShot>G.mechanics.fireRate*1000){p.shots.push({x:p.px*w,y:p.py*h});p.lastShot=now}p.spawn-=dt;if(p.spawn<=0){p.enemies.push({x:rng()*.8*w+w*.1,y:-20,v:2+rng()*2});if(rng()<.45)p.stars.push({x:rng()*w,y:-15});p.spawn=(G.difficulty==='hard'?27:G.difficulty==='easy'?50:36)/G.mechanics.enemyDensity}for(const s of p.shots){s.y-=9*dt;ctx.fillStyle='#68e8ff';ctx.fillRect(s.x-2,s.y,4,16)}for(const e of p.enemies){e.y+=e.v*dt;ctx.fillStyle='#ff6582';ctx.beginPath();ctx.moveTo(e.x,e.y+15);ctx.lineTo(e.x-14,e.y-12);ctx.lineTo(e.x+14,e.y-12);ctx.fill();if(Math.abs(e.x-p.px*w)<20&&Math.abs(e.y-p.py*h)<20)show('Ship hit · score '+score);if(p.shots.some(s=>Math.abs(s.x-e.x)<18&&Math.abs(s.y-e.y)<20)){e.y=h+100;score+=10;p.kills++}}for(const a of p.stars){a.y+=3*dt;button(a.x,a.y,7,'#ffd166');if(Math.abs(a.x-p.px*w)<20&&Math.abs(a.y-p.py*h)<20){a.y=h+100;score+=5}}p.shots=p.shots.filter(s=>s.y>-20);p.enemies=p.enemies.filter(e=>e.y<h+30);p.stars=p.stars.filter(a=>a.y<h+20);ctx.fillStyle=accent;ctx.beginPath();ctx.moveTo(p.px*w,p.py*h-18);ctx.lineTo(p.px*w-17,p.py*h+17);ctx.lineTo(p.px*w+17,p.py*h+17);ctx.fill();const target=G.mechanics.targetKills;if(p.kills>=target)show('Sector cleared!',true);hud('Score '+score+' · Enemies '+p.kills+'/'+target)}
function puzzleStart(){const n=G.mechanics.gridSize,colorsN=G.mechanics.colorCount;return{n,tiles:Array.from({length:n*n},()=>Math.floor(rng()*colorsN)),pick:-1,moves:G.difficulty==='easy'?40:G.difficulty==='hard'?22:30,matches:0}}
function drawPuzzle(){const p=state,size=Math.min(w*.78,h*.72),cell=size/p.n,left=(w-size)/2,top=(h-size)/2;for(let i=0;i<p.tiles.length;i++){const row=Math.floor(i/p.n),col=i%p.n,x=left+col*cell,y=top+row*cell;ctx.fillStyle=colors[p.tiles[i]];ctx.globalAlpha=i===p.pick?1:.78;ctx.beginPath();ctx.roundRect(x+3,y+3,cell-6,cell-6,8);ctx.fill();ctx.globalAlpha=1;if(i===p.pick){ctx.strokeStyle='white';ctx.lineWidth=3;ctx.stroke()}}hud('Matches '+p.matches+'/'+G.mechanics.targetMatches+' · Moves '+p.moves)}
function resolvePuzzle(){const p=state,n=p.n,need=G.mechanics.matchLength,matched=new Set();for(let r=0;r<n;r++)for(let col=0;col<n;col++){const i=r*n+col,v=p.tiles[i];let run=1;while(col+run<n&&p.tiles[i+run]===v)run++;if(run>=need)for(let k=0;k<run;k++)matched.add(i+k);run=1;while(r+run<n&&p.tiles[i+run*n]===v)run++;if(run>=need)for(let k=0;k<run;k++)matched.add(i+k*n)}if(!matched.size)return false;for(const i of matched){p.tiles[i]=Math.floor(rng()*G.mechanics.colorCount)}p.matches++;score+=matched.size*10;if(p.matches>=G.mechanics.targetMatches)show('Puzzle solved!',true);else if(p.moves<=0)show('No moves left · score '+score);return true}
document.querySelector('#start').onclick=start;
c.addEventListener('pointerdown',e=>{if(!active)return;if(G.schemaVersion===2&&G.gameType==='puzzle'){const p=state,size=Math.min(w*.78,h*.72),cell=size/p.n,left=(w-size)/2,top=(h-size)/2,col=Math.floor((e.offsetX-left)/cell),row=Math.floor((e.offsetY-top)/cell),i=row*p.n+col;if(col<0||col>=p.n||row<0||row>=p.n)return;if(p.pick<0){p.pick=i;return}if(Math.abs(p.pick%p.n-col)+Math.abs(Math.floor(p.pick/p.n)-row)===1){const a=p.tiles[p.pick],b=p.tiles[i];p.tiles[p.pick]=b;p.tiles[i]=a;p.moves--;if(!resolvePuzzle()){p.tiles[p.pick]=a;p.tiles[i]=b}if(p.moves<=0&&p.matches<G.mechanics.targetMatches)show('No moves left · score '+score)}p.pick=-1;return}if(G.schemaVersion===2&&G.gameType==='rally'){state.car=Math.max(.12,Math.min(.88,e.offsetX/w));return}if(G.schemaVersion===2&&G.gameType==='shooter'){state.px=e.offsetX/w;state.py=e.offsetY/h;state.shots.push({x:state.px*w,y:state.py*h});return}if((G.schemaVersion===1||G.gameType==='runner')&&state.py>=.739)state.vy=-.026*(G.schemaVersion===2?G.mechanics.jumpHeight:1);if(G.gameType==='platformer'&&state.ground){state.vy=-11;state.ground=false}});
window.addEventListener('keydown',e=>{keys[e.code]=true;if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault()});window.addEventListener('keyup',e=>{keys[e.code]=false});
document.querySelector('#headline').textContent='Ready · '+G.gameType;document.querySelector('#start').textContent='Play';window.parent.postMessage({type:'lord-game-ready'},'*');</script></body></html>`;
}

function escapeHtml(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
