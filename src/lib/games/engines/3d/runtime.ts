import { Game3DSpecSchema, parseGame3DSpecForPreview, type Game3DSpec } from "../../game-spec-3d";
import { evaluateThreeGameOutcome } from "./progression";
import {
  applyEnemyDamage,
  canSelectFightingSuit,
  createFightingProgress,
  getCombatDamage,
  getFightEnemyCount,
  getFightEnemyHealth,
  getFightRoundNumber,
  type CombatMove,
  type FightingProgress,
  type FightingSpec,
} from "./fighting";

export type Game3DAction =
  | "left"
  | "right"
  | "jump"
  | "accelerate"
  | "brake"
  | "up"
  | "down"
  | "fire"
  | "punch"
  | "kick"
  | "dodge"
  | "web";
export type GraphicsQuality = "low" | "medium" | "high";
export type Game3DStatus = {
  status: "ready" | "playing" | "paused" | "completed" | "failed";
  hud: string;
  error?: string;
  fightingProgress?: FightingProgress;
  battle?: number;
  battleCount?: number;
  enemyHealth?: Array<{ key: string; health: number; maxHealth: number }>;
};
export type Game3DHandle = {
  action(action: Game3DAction, pressed: boolean): void;
  start(): void;
  pause(): void;
  resume(): void;
  restart(): void;
  setQuality(quality: GraphicsQuality): void;
  setSuit(suitKey: string): void;
  dispose(): void;
};

export function getQualityPixelRatio(devicePixelRatio: number, quality: GraphicsQuality): number {
  const deviceRatio =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(deviceRatio, quality === "low" ? 1 : quality === "medium" ? 1.25 : 1.5);
}

export function getEnvironmentAssetCount(
  assetDensity: number,
  environment: Game3DSpec["environmentPreset"],
  quality: GraphicsQuality,
): number {
  const count = environment === "space-nebula" ? 140 : 26 + assetDensity * 12;
  return quality === "low"
    ? Math.min(count, 36)
    : quality === "medium"
      ? Math.min(count, 72)
      : count;
}

const PALETTES = {
  neon: { sky: 0x071426, ground: 0x102838, accent: 0x30eaff },
  jungle: { sky: 0x10231c, ground: 0x31523a, accent: 0x9df38a },
  desert: { sky: 0x46311e, ground: 0x987244, accent: 0xffd27a },
  space: { sky: 0x050817, ground: 0x11172e, accent: 0x74deff },
  ancient: { sky: 0x221b2a, ground: 0x675346, accent: 0xffcf75 },
} as const;
const SUIT_COLORS: Record<
  Extract<Game3DSpec, { gameType: "fighting" }>["suits"][number]["accent"],
  number
> = {
  crimson: 0xc83f56,
  cyan: 0x37cde0,
  gold: 0xd5a943,
  violet: 0x8b68d8,
  emerald: 0x3caa7e,
  silver: 0x9baebc,
  obsidian: 0x252a38,
};

function isRacingGame(
  spec: Game3DSpec,
): spec is Extract<Game3DSpec, { gameType: "rally" | "racing" }> {
  return spec.gameType === "rally" || spec.gameType === "racing";
}

function isExplorationGame(
  spec: Game3DSpec,
): spec is Extract<Game3DSpec, { gameType: "adventure" | "exploration" | "platformer" }> {
  return (
    spec.gameType === "adventure" ||
    spec.gameType === "exploration" ||
    spec.gameType === "platformer"
  );
}

export async function mountThreeGame(
  host: HTMLElement,
  input: unknown,
  report: (value: Game3DStatus) => void,
  quality: GraphicsQuality = "medium",
  initialFightingProgress?: FightingProgress,
): Promise<Game3DHandle> {
  const parsed = parseGame3DSpecForPreview(input);
  if ("error" in parsed) throw new Error(parsed.error);
  const spec = parsed.spec;
  const isRacing = isRacingGame(spec);
  const isExploration = isExplorationGame(spec);
  const isFighting = spec.gameType === "fighting";
  const THREE = await import("three");
  let renderer: InstanceType<typeof THREE.WebGLRenderer>;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: "low-power",
    });
  } catch {
    throw new Error(
      "WebGL is unavailable in this browser. Enable hardware acceleration or use a supported browser.",
    );
  }
  const palette = PALETTES[spec.palette];
  const scene = new THREE.Scene();
  const visual = getVisualPalette(THREE, spec);
  scene.background = new THREE.Color(visual.sky);
  scene.fog = new THREE.Fog(
    visual.fog,
    spec.lighting.fogDistance * (spec.atmosphere === "clear" ? 0.7 : 0.28),
    spec.lighting.fogDistance,
  );
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(620, 24, 12),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        zenith: { value: new THREE.Color(visual.sky) },
        horizon: { value: new THREE.Color(visual.fog) },
      },
      vertexShader:
        "varying float skyHeight; void main(){ skyHeight=normalize(position).y; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
      fragmentShader:
        "uniform vec3 zenith; uniform vec3 horizon; varying float skyHeight; void main(){ float t=smoothstep(-0.22,0.82,skyHeight); gl_FragColor=vec4(mix(horizon,zenith,t),1.0); }",
    }),
  );
  scene.add(sky);
  const camera = new THREE.PerspectiveCamera(spec.camera.fov, 1, 0.1, 700);
  camera.position.set(0, spec.camera.height, spec.camera.followDistance);
  const ambient = new THREE.HemisphereLight(visual.sky, visual.ground, spec.lighting.ambient);
  const keyLight = new THREE.DirectionalLight(visual.key, spec.lighting.directional);
  keyLight.position.set(-8, 18, 8);
  scene.add(ambient, keyLight);
  let qualitySetting = quality;
  renderer.setPixelRatio(getQualityPixelRatio(window.devicePixelRatio, qualitySetting));
  renderer.shadowMap.enabled = qualitySetting === "high";
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if (renderer.shadowMap.enabled) {
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.left = -18;
    keyLight.shadow.camera.right = 18;
    keyLight.shadow.camera.top = 24;
    keyLight.shadow.camera.bottom = -18;
  }
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute("aria-label", `${spec.title} Three-dimensional game area`);
  renderer.domElement.tabIndex = 0;
  renderer.domElement.style.cssText =
    "display:block;width:100%;height:100%;outline:none;touch-action:none";
  host.replaceChildren(renderer.domElement);

  const world = new THREE.Group();
  scene.add(world);
  const animateEnvironment = buildEnvironment(THREE, world, spec, visual, quality);

  const player = makePlayer(THREE, spec.gameType, palette.accent);
  player.position.set(0, 0, 0);
  if (spec.gameType === "runner" || isExploration || isRacing) player.rotation.y = Math.PI;
  scene.add(player);
  if (isFighting) addFightingArena(THREE, world, visual);
  const objects: Array<{
    key: string;
    mesh: InstanceType<typeof THREE.Group>;
    kind: string;
    lane: number;
    distance: number;
    consumed: boolean;
  }> = [];
  const entityKeys = new Set(
    [...spec.obstacles, ...spec.collectibles, ...spec.enemies].map((item) => item.key),
  );
  const runtimeEntityKey = (name: string) => {
    let key = `runtime-${name}`;
    let suffix = 2;
    while (entityKeys.has(key)) key = `runtime-${name}-${suffix++}`;
    entityKeys.add(key);
    return key;
  };
  const makeObject = (
    key: string,
    kind: string,
    lane: number,
    distance: number,
    enemyObject = false,
  ) => {
    const group = new THREE.Group();
    const color =
      kind === "fuel"
        ? 0x45ef9b
        : kind === "coin" || kind === "star"
          ? 0xffd166
          : kind === "crystal"
            ? 0x65efff
            : enemyObject
              ? 0xf66c90
              : kind === "rock"
                ? 0x8a8179
                : 0xff647e;
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness:
        spec.materialStyle === "metallic"
          ? 0.24
          : spec.materialStyle === "matte"
            ? 0.92
            : spec.materialStyle === "stone" || spec.materialStyle === "organic"
              ? 0.82
              : 0.55,
      metalness:
        spec.materialStyle === "metallic" ? 0.62 : kind === "coin" || kind === "star" ? 0.45 : 0.08,
    });
    if (["coin", "fuel", "crystal", "star"].includes(kind)) {
      const shape =
        kind === "fuel"
          ? new THREE.CylinderGeometry(0.28, 0.28, 0.62, 8)
          : kind === "crystal"
            ? new THREE.OctahedronGeometry(0.38)
            : new THREE.TorusGeometry(0.34, 0.11, 6, 12);
      const item = new THREE.Mesh(shape, material);
      item.position.y = 1.1;
      group.add(item);
    } else if (kind === "platform") {
      group.add(new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.38, 2.4), material));
      group.position.x = lane * 2.3;
      group.position.y = 0.35 + (Math.round(distance) % 3) * 0.45;
    } else if (kind === "asteroid" || kind === "rock") {
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(kind === "asteroid" ? 0.9 : 0.72, 1),
        material,
      );
      rock.position.y = 0.8;
      group.add(rock);
    } else if (enemyObject || kind === "drone" || kind === "sentinel") {
      group.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.72, 1), material));
      const wing = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 0.3), material);
      group.add(wing);
      group.position.y = 1.2;
    } else {
      group.add(new THREE.Mesh(new THREE.BoxGeometry(1.65, 1.45, 0.85), material));
      group.position.y = 0.75;
    }
    group.position.x = lane * 2.3;
    group.position.z = -distance;
    world.add(group);
    objects.push({ key, mesh: group, kind, lane, distance, consumed: false });
  };
  for (const item of spec.obstacles) makeObject(item.key, item.kind, item.lane, item.distance);
  for (const item of spec.collectibles) makeObject(item.key, item.kind, item.lane, item.distance);
  for (const item of spec.enemies) makeObject(item.key, item.kind, item.lane, item.distance, true);
  if (spec.gameType === "runner") {
    const obstacleCount = objects.filter(
      (object) => !["coin", "fuel", "crystal", "star"].includes(object.kind),
    ).length;
    for (let i = obstacleCount; i < Math.min(5, obstacleCount + 4); i++)
      makeObject(runtimeEntityKey(`runner-obstacle-${i}`), "barrier", (i % 3) - 1, 42 + i * 30);
    const coinCount = objects.filter((object) => ["coin", "star"].includes(object.kind)).length;
    for (let i = coinCount; i < Math.min(6, coinCount + 5); i++)
      makeObject(runtimeEntityKey(`runner-coin-${i}`), "coin", ((i + 1) % 3) - 1, 30 + i * 27);
  }
  if (isRacing) {
    const rockCount = objects.filter((object) => ["rock", "barrier"].includes(object.kind)).length;
    for (let i = rockCount; i < Math.min(5, rockCount + 4); i++)
      makeObject(runtimeEntityKey(`rally-rock-${i}`), "rock", (i % 3) - 1, 48 + i * 38);
    const fuelCount = objects.filter((object) => object.kind === "fuel").length;
    for (let i = fuelCount; i < Math.min(6, fuelCount + 5); i++)
      makeObject(runtimeEntityKey(`rally-fuel-${i}`), "fuel", ((i + 1) % 3) - 1, 30 + i * 42);
  }
  if (spec.gameType === "shooter") {
    const configured = objects.filter((object) =>
      ["drone", "asteroid", "sentinel"].includes(object.kind),
    ).length;
    for (let i = configured; i < spec.mechanics.targetKills; i++)
      makeObject(runtimeEntityKey(`shooter-drone-${i}`), "drone", (i % 3) - 1, 40 + i * 20, true);
  }
  if (isExploration) {
    const platformCount = objects.filter((object) => object.kind === "platform").length;
    for (let i = platformCount; i < Math.min(10, platformCount + 5); i++)
      makeObject(runtimeEntityKey(`adventure-platform-${i}`), "platform", (i % 3) - 1, 28 + i * 28);
    const treasureCount = objects.filter((object) =>
      ["coin", "crystal"].includes(object.kind),
    ).length;
    for (
      let i = treasureCount;
      i < Math.min(12, Math.max(treasureCount, spec.mechanics.collectibleGoal));
      i++
    )
      makeObject(
        runtimeEntityKey(`adventure-treasure-${i}`),
        "crystal",
        ((i + 1) % 3) - 1,
        40 + i * 24,
      );
  }

  const inputs = new Set<Game3DAction>();
  const projectiles: Array<{ mesh: InstanceType<typeof THREE.Mesh>; z: number }> = [];
  const clock = new THREE.Clock();
  let raf = 0;
  let active = false;
  let disposed = false;
  let ended = false;
  let finalStatus: "completed" | "failed" = "failed";
  let lastReportAt = 0;
  let lastReportedStatus: Game3DStatus["status"] | "" = "";
  let runtimeError: string | undefined;
  let speed = isRacing ? 0 : spec.gameType === "runner" ? spec.mechanics.speed : 9;
  let distance = 0;
  let score = 0;
  let fuel = isRacing ? spec.mechanics.fuelCapacity : 100;
  let health = spec.gameType === "shooter" ? spec.mechanics.health : spec.health;
  let kills = 0;
  let playerX = 0;
  let jumpVelocity = 0;
  let adventureGround = 0;
  let activePlatformZ: number | null = null;
  let lastShot = 0;
  const fightingSpec = isFighting ? (spec as FightingSpec) : null;
  let fightingProgress = fightingSpec
    ? createFightingProgress(
        fightingSpec,
        initialFightingProgress?.wins ?? 0,
        initialFightingProgress?.selectedSuitKey,
      )
    : undefined;
  let fightingStartWins = fightingProgress?.wins ?? 0;
  let fightingEndWins = fightingStartWins + (fightingSpec?.mechanics.battleCount ?? 0);
  let playerCombatHealth = fightingSpec?.mechanics.playerHealth ?? 0;
  let comboCount = 0;
  let comboExpires = 0;
  let dodgeExpires = 0;
  let lastEnemyHit = 0;
  const lastMoveAt: Record<CombatMove, number> = { punch: 0, kick: 0, web: 0 };
  let audioContext: AudioContext | null = null;
  let audioUnavailable = false;
  const playSound = (action: Game3DAction) => {
    if (
      !spec.audio.enabled ||
      spec.audio.volume <= 0 ||
      audioUnavailable ||
      typeof AudioContext === "undefined"
    )
      return;
    try {
      audioContext ??= new AudioContext();
      if (audioContext.state === "suspended") {
        void audioContext
          .resume()
          .catch((error: unknown) => console.warn("[games] Audio could not resume", error));
      }
      const frequencies: Partial<Record<Game3DAction, number>> = {
        jump: 620,
        accelerate: 260,
        brake: 170,
        fire: 880,
        punch: 220,
        kick: 150,
        dodge: 540,
        web: 740,
      };
      const frequency = frequencies[action];
      if (!frequency) return;
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const now = audioContext.currentTime;
      oscillator.frequency.setValueAtTime(frequency, now);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(spec.audio.volume * 0.08, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.14);
    } catch (error) {
      audioUnavailable = true;
      console.warn("[games] Audio effects are unavailable", error);
    }
  };
  const getLevelIndex = (value: number) => {
    const index = spec.levels.findIndex((level) => value < level.distance);
    return index < 0 ? spec.levels.length - 1 : index;
  };
  let fightNumber = 0;
  const combatEnemies: Array<{
    key: string;
    mesh: InstanceType<typeof THREE.Group>;
    bar: InstanceType<typeof THREE.Mesh>;
    barAnchor: InstanceType<typeof THREE.Group>;
    health: number;
    maxHealth: number;
    attackAt: number;
    index: number;
  }> = [];
  const combatEffects: Array<{ mesh: InstanceType<typeof THREE.Object3D>; expires: number }> = [];

  const clearCombatWave = () => {
    for (const enemy of combatEnemies) {
      world.remove(enemy.mesh);
      enemy.mesh.traverse((node) => {
        const mesh = node as InstanceType<typeof THREE.Mesh>;
        if (mesh.isMesh) {
          mesh.geometry.dispose();
          for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
            material.dispose();
        }
      });
    }
    combatEnemies.length = 0;
  };
  const spawnCombatWave = () => {
    if (!fightingSpec) return;
    clearCombatWave();
    fightNumber++;
    const count = getFightEnemyCount(fightingSpec, fightingProgress?.wins ?? 0);
    const enemyHealth = getFightEnemyHealth(fightingSpec, fightingProgress?.wins ?? 0);
    for (let index = 0; index < count; index++) {
      const key = `fight-${fightingProgress?.wins ?? 0}-${fightNumber}-${index + 1}`;
      const enemy = makeFighterModel(
        THREE,
        false,
        [0xf26868, 0xe6a24c, 0xa879e8, 0x53b9ae, 0xd06e99][index % 5],
      );
      const x = (index - (count - 1) / 2) * 3.2;
      enemy.position.set(x, 0, -4.2 - (index % 2) * 1.6);
      enemy.rotation.y = Math.PI;
      const bar = new THREE.Group();
      const back = new THREE.Mesh(
        new THREE.PlaneGeometry(1.15, 0.12),
        new THREE.MeshBasicMaterial({ color: 0x241a25, transparent: true, opacity: 0.9 }),
      );
      const fill = new THREE.Mesh(
        new THREE.PlaneGeometry(1.08, 0.075),
        new THREE.MeshBasicMaterial({ color: 0x5aeea2 }),
      );
      fill.position.z = 0.01;
      fill.position.x = -0.035;
      bar.add(back, fill);
      bar.position.set(0, 2.72, 0);
      enemy.add(bar);
      world.add(enemy);
      combatEnemies.push({
        key,
        mesh: enemy,
        bar: fill,
        barAnchor: bar,
        health: enemyHealth,
        maxHealth: enemyHealth,
        attackAt: performance.now() + 700 + index * 250,
        index,
      });
    }
  };
  const updateFightingProgress = () => {
    if (!fightingSpec || !fightingProgress) return;
    fightingProgress = createFightingProgress(
      fightingSpec,
      fightingProgress.wins,
      fightingProgress.selectedSuitKey,
    );
  };
  const applyFightingSuit = () => {
    if (!isFighting || !fightingProgress) return;
    const selected = spec.suits.find((suit) => suit.key === fightingProgress?.selectedSuitKey);
    const color = SUIT_COLORS[selected?.accent ?? "crimson"];
    player.traverse((node) => {
      if (node.userData.suitAccent) {
        const mesh = node as InstanceType<typeof THREE.Mesh>;
        (mesh.material as InstanceType<typeof THREE.MeshStandardMaterial>).color.setHex(color);
      }
    });
  };
  const chooseTarget = (range: number) =>
    combatEnemies
      .filter((enemy) => enemy.health > 0)
      .map((enemy) => ({ enemy, distance: enemy.mesh.position.distanceTo(player.position) }))
      .filter((entry) => entry.distance <= range)
      .sort((a, b) => a.distance - b.distance)[0];
  const combatHit = (move: CombatMove, now: number) => {
    if (
      !fightingSpec ||
      now - lastMoveAt[move] < (move === "punch" ? 360 : move === "kick" ? 620 : 760)
    )
      return;
    lastMoveAt[move] = now;
    if (now > comboExpires) comboCount = 0;
    comboCount = Math.min(fightingSpec.mechanics.comboTarget, comboCount + 1);
    comboExpires = now + 1150;
    const target = chooseTarget(move === "web" ? 10 : move === "kick" ? 3.1 : 2.5);
    if (!target) {
      emit("playing", true);
      return;
    }
    target.enemy.health = applyEnemyDamage(
      target.enemy.health,
      getCombatDamage(fightingSpec, move, comboCount),
    );
    target.enemy.bar.scale.x = Math.max(0.001, target.enemy.health / target.enemy.maxHealth);
    (target.enemy.bar.material as InstanceType<typeof THREE.MeshBasicMaterial>).color.setHSL(
      0.34 * (target.enemy.health / target.enemy.maxHealth),
      0.85,
      0.58,
    );
    target.enemy.mesh.rotation.y = Math.atan2(
      -(player.position.x - target.enemy.mesh.position.x),
      -(player.position.z - target.enemy.mesh.position.z),
    );
    if (move === "web") {
      const web = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.12, Math.max(0.4, target.distance), 6),
        new THREE.MeshBasicMaterial({ color: 0xdffaff }),
      );
      web.position.copy(player.position).lerp(target.enemy.mesh.position, 0.5);
      web.position.y += 1.4;
      web.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3().subVectors(target.enemy.mesh.position, player.position).normalize(),
      );
      world.add(web);
      combatEffects.push({ mesh: web, expires: now + 180 });
    }
    const impact = new THREE.Mesh(
      new THREE.TorusGeometry(0.26, 0.055, 5, 12),
      new THREE.MeshBasicMaterial({
        color: move === "web" ? 0xe8fdff : 0xffd197,
        transparent: true,
        opacity: 0.95,
      }),
    );
    impact.position.copy(target.enemy.mesh.position);
    impact.position.y += 1.2;
    world.add(impact);
    combatEffects.push({ mesh: impact, expires: now + 240 });
    if (target.enemy.health <= 0) target.enemy.mesh.visible = false;
    const alive = combatEnemies.some((enemy) => enemy.health > 0);
    if (!alive) {
      if (fightingProgress)
        fightingProgress = createFightingProgress(
          fightingSpec,
          fightingProgress.wins + 1,
          fightingProgress.selectedSuitKey,
        );
      if (playerCombatHealth > 0)
        playerCombatHealth = Math.min(
          fightingSpec.mechanics.playerHealth,
          playerCombatHealth + Math.ceil(fightingSpec.mechanics.playerHealth * 0.2),
        );
      updateFightingProgress();
      const outcome = evaluateThreeGameOutcome(fightingSpec, {
        distance: 0,
        health: playerCombatHealth,
        fuel: 0,
        kills: 0,
        collectibles: 0,
        victories: (fightingProgress?.wins ?? fightingStartWins) - fightingStartWins,
      });
      if (outcome === "completed") finish(true);
      else spawnCombatWave();
    }
    emit(ended ? finalStatus : "playing", true);
  };

  const emit = (status: Game3DStatus["status"], force = false) => {
    const now = performance.now();
    if (!force && status === lastReportedStatus && now - lastReportAt < 180) return;
    lastReportAt = now;
    lastReportedStatus = status;
    const levelNumber = getLevelIndex(distance);
    const levelLabel = `Level ${levelNumber + 1}: ${spec.levels[levelNumber].name}`;
    const hud = isFighting
      ? `Health ${playerCombatHealth}/${fightingSpec?.mechanics.playerHealth} · Combo x${comboCount}`
      : isRacing
        ? `${levelLabel} · Speed ${Math.round(speed * 8)} · Fuel ${Math.max(0, Math.round(fuel))} · ${Math.floor(distance)} m`
        : spec.gameType === "shooter"
          ? `${levelLabel} · Hull ${health} · Targets ${kills}/${spec.mechanics.targetKills} · Score ${score}`
          : `${levelLabel} · Health ${health} · Distance ${Math.floor(distance)} m · Score ${score}`;
    report({
      status,
      hud,
      ...(runtimeError ? { error: runtimeError } : {}),
      ...(isFighting && fightingSpec && fightingProgress
        ? {
            fightingProgress,
            battle: getFightRoundNumber(fightingSpec, fightingProgress.wins),
            battleCount: fightingSpec.mechanics.battleCount,
            enemyHealth: combatEnemies.map((enemy) => ({
              key: enemy.key,
              health: enemy.health,
              maxHealth: enemy.maxHealth,
            })),
          }
        : {}),
    });
  };
  const finish = (won: boolean) => {
    if (ended) return;
    ended = true;
    finalStatus = won ? "completed" : "failed";
    active = false;
    emit(won ? "completed" : "failed");
  };
  const reset = (startGame = true) => {
    distance = 0;
    score = 0;
    kills = 0;
    playerX = 0;
    jumpVelocity = 0;
    adventureGround = 0;
    activePlatformZ = null;
    runtimeError = undefined;
    health = spec.gameType === "shooter" ? spec.mechanics.health : spec.health;
    fuel = isRacing ? spec.mechanics.fuelCapacity : 100;
    speed = isRacing ? 0 : spec.gameType === "runner" ? spec.mechanics.speed : 9;
    ended = false;
    finalStatus = "failed";
    active = startGame;
    player.position.set(0, 0, 0);
    for (const object of objects) {
      object.consumed = false;
      object.mesh.visible = true;
      object.mesh.position.z = -object.distance;
    }
    for (const shot of projectiles) {
      world.remove(shot.mesh);
      shot.mesh.geometry.dispose();
      (shot.mesh.material as InstanceType<typeof THREE.MeshStandardMaterial>).dispose();
    }
    projectiles.length = 0;
    if (isFighting && fightingSpec && fightingProgress) {
      fightingStartWins = fightingProgress.wins;
      fightingEndWins = fightingStartWins + fightingSpec.mechanics.battleCount;
      playerCombatHealth = fightingSpec.mechanics.playerHealth;
      comboCount = 0;
      comboExpires = 0;
      dodgeExpires = 0;
      lastEnemyHit = 0;
      clearCombatWave();
      for (const effect of combatEffects) {
        world.remove(effect.mesh);
        (effect.mesh as InstanceType<typeof THREE.Mesh>).geometry?.dispose();
        const material = (effect.mesh as InstanceType<typeof THREE.Mesh>).material;
        if (material)
          for (const item of Array.isArray(material) ? material : [material]) item.dispose();
      }
      combatEffects.length = 0;
      applyFightingSuit();
      spawnCombatWave();
    }
    clock.start();
    emit(startGame ? "playing" : "ready");
    cancelAnimationFrame(raf);
    if (startGame) raf = requestAnimationFrame(frame);
    else renderer.render(scene, camera);
  };
  const tickFighting = (dt: number, elapsed: number) => {
    if (!fightingSpec || !fightingProgress) return;
    const now = performance.now();
    const moveX = Number(inputs.has("right")) - Number(inputs.has("left"));
    const moveZ = Number(inputs.has("down")) - Number(inputs.has("up"));
    const movement = new THREE.Vector3(moveX, 0, moveZ);
    if (movement.lengthSq() > 0) {
      movement.normalize().multiplyScalar(4.5 * dt);
      player.position.add(movement);
      player.position.x = THREE.MathUtils.clamp(player.position.x, -8.2, 8.2);
      player.position.z = THREE.MathUtils.clamp(player.position.z, -10.2, 4.2);
      player.rotation.y = Math.atan2(moveX, -moveZ || 1);
    }
    if (inputs.has("dodge") && now >= dodgeExpires) {
      dodgeExpires = now + 720;
      player.position.x = THREE.MathUtils.clamp(
        player.position.x + (moveX || (player.position.x >= 0 ? -1 : 1)) * 1.45,
        -8.2,
        8.2,
      );
    }
    if (inputs.has("punch")) combatHit("punch", now);
    if (inputs.has("kick")) combatHit("kick", now);
    if (inputs.has("web")) combatHit("web", now);
    if (!active) return;
    for (const enemy of combatEnemies) {
      if (enemy.health <= 0) continue;
      enemy.barAnchor.quaternion.copy(camera.quaternion);
      const dx = player.position.x - enemy.mesh.position.x;
      const dz = player.position.z - enemy.mesh.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 1.65) {
        const speedScale =
          1 + (getFightRoundNumber(fightingSpec, fightingProgress.wins) - 1) * 0.18;
        enemy.mesh.position.x += (dx / distance) * dt * 1.28 * speedScale;
        enemy.mesh.position.z += (dz / distance) * dt * 1.28 * speedScale;
      } else if (now >= enemy.attackAt) {
        enemy.attackAt = now + 950 + (enemy.index % 2) * 170;
        if (now >= dodgeExpires) {
          playerCombatHealth = Math.max(
            0,
            playerCombatHealth - (8 + getFightRoundNumber(fightingSpec, fightingProgress.wins) * 2),
          );
          lastEnemyHit = now;
          emit("playing", true);
          if (playerCombatHealth <= 0) {
            finish(false);
            return;
          }
        }
      }
      enemy.mesh.rotation.y = Math.atan2(-dx, -dz);
      const limbs = enemy.mesh.userData.limbs as InstanceType<typeof THREE.Mesh>[] | undefined;
      limbs?.forEach((limb, index) => {
        limb.rotation.x = Math.sin(elapsed * 4 + enemy.index + index) * 0.08;
      });
    }
    const heroLimbs = player.userData.limbs as InstanceType<typeof THREE.Mesh>[] | undefined;
    heroLimbs?.forEach((limb, index) => {
      limb.rotation.x = Math.sin(elapsed * 8 + index) * (movement.lengthSq() > 0 ? 0.24 : 0.035);
    });
    player.position.y = now < dodgeExpires ? 0.08 : Math.sin(elapsed * 3) * 0.025;
    player.traverse((node) => {
      if (node.userData.suitAccent) return;
      const mesh = node as InstanceType<typeof THREE.Mesh>;
      if (
        mesh.isMesh &&
        mesh.material instanceof THREE.MeshStandardMaterial &&
        mesh.userData.damageFlash
      )
        mesh.material.emissiveIntensity = now - lastEnemyHit < 120 ? 0.9 : 0.1;
    });
    for (let i = combatEffects.length - 1; i >= 0; i--) {
      const effect = combatEffects[i];
      if (now >= effect.expires) {
        world.remove(effect.mesh);
        const mesh = effect.mesh as InstanceType<typeof THREE.Mesh>;
        mesh.geometry?.dispose();
        if (mesh.material)
          for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
            material.dispose();
        combatEffects.splice(i, 1);
      }
    }
    const target = new THREE.Vector3(
      player.position.x * 0.45,
      spec.camera.height + 2.2,
      player.position.z + spec.camera.followDistance,
    );
    camera.position.lerp(target, 1 - Math.exp(-dt * 3.8));
    camera.lookAt(player.position.x * 0.25, 1.2, player.position.z - 2.3);
    renderer.render(scene, camera);
    emit("playing");
  };
  const frame = () => {
    if (disposed || !active) return;
    try {
      const dt = Math.min(clock.getDelta(), 0.04);
      const elapsed = clock.elapsedTime;
      if (isFighting) {
        tickFighting(dt, elapsed);
        if (active) raf = requestAnimationFrame(frame);
        return;
      }
      if (isRacing) {
        speed +=
          ((inputs.has("accelerate") ? spec.mechanics.acceleration : 0) -
            (inputs.has("brake") ? spec.mechanics.acceleration * 1.35 : 0) -
            speed * spec.physics.friction) *
          dt;
        speed = Math.max(0, Math.min(22, speed));
        fuel -= spec.mechanics.fuelDrain * (0.35 + speed / 12) * dt;
      } else if (spec.gameType === "runner") {
        speed = Math.min(spec.mechanics.speed * 1.65, speed + dt * 0.035);
      }
      const levelNumber = getLevelIndex(distance);
      const speedFactor =
        (isRacing ? speed : spec.gameType === "shooter" ? 7 : speed) *
        spec.levels[levelNumber].speedScale;
      if (isExploration) {
        if (inputs.has("up"))
          player.position.z = Math.max(
            -spec.mechanics.finishDistance,
            player.position.z - spec.mechanics.playerSpeed * dt,
          );
        if (inputs.has("down"))
          player.position.z = Math.min(0, player.position.z + spec.mechanics.playerSpeed * dt);
        distance = -player.position.z;
      } else {
        distance += speedFactor * dt;
      }
      score = Math.floor(distance * (isRacing ? 1 : 2) * (spec.scoring.distancePoints / 2));
      if (inputs.has("left")) playerX = Math.max(-1, playerX - dt * (isRacing ? 0.9 : 2.4));
      if (inputs.has("right")) playerX = Math.min(1, playerX + dt * (isRacing ? 0.9 : 2.4));
      if (spec.gameType === "shooter" && inputs.has("up"))
        player.position.z = Math.max(-1.8, player.position.z - dt * 4);
      if (spec.gameType === "shooter" && inputs.has("down"))
        player.position.z = Math.min(1.8, player.position.z + dt * 4);
      if (
        inputs.has("jump") &&
        player.position.y <= adventureGround + 0.02 &&
        (spec.gameType === "runner" || isExploration)
      ) {
        jumpVelocity =
          spec.gameType === "runner"
            ? spec.mechanics.jumpHeight * 2.2
            : spec.mechanics.jumpHeight * 2;
        inputs.delete("jump");
      }
      if (jumpVelocity > 0 || player.position.y > 0) {
        player.position.y += jumpVelocity * dt;
        jumpVelocity -= spec.physics.gravity * dt;
        if (player.position.y < adventureGround) {
          player.position.y = adventureGround;
          jumpVelocity = 0;
        }
      }
      if (isExploration && activePlatformZ !== null && player.position.z < activePlatformZ - 2) {
        adventureGround = 0;
        activePlatformZ = null;
      }
      player.position.x = playerX * 2.25;
      player.rotation.z = -playerX * (isRacing ? 0.12 : 0.08);
      if (isRacing)
        player.rotation.y =
          Math.PI + (inputs.has("left") ? 0.16 : 0) - (inputs.has("right") ? 0.16 : 0);
      if (
        spec.gameType === "shooter" &&
        inputs.has("fire") &&
        performance.now() - lastShot >= spec.mechanics.fireRate * 1000
      ) {
        const laser = new THREE.Mesh(
          new THREE.CylinderGeometry(0.055, 0.055, 1.25, 6),
          new THREE.MeshBasicMaterial({ color: palette.accent }),
        );
        laser.rotation.x = Math.PI / 2;
        laser.position.set(player.position.x, 0.7, player.position.z - 1.2);
        world.add(laser);
        projectiles.push({ mesh: laser, z: laser.position.z });
        lastShot = performance.now();
      }
      for (const shot of projectiles) {
        shot.mesh.position.z -= dt * 28;
        shot.z = shot.mesh.position.z;
      }
      for (const object of objects) {
        if (object.consumed) continue;
        if (["coin", "fuel", "crystal", "star"].includes(object.kind)) {
          object.mesh.rotation.y += dt * 1.8;
          object.mesh.position.y = 0.12 * Math.sin(elapsed * 2.4 + object.distance) + 0.05;
        }
        if (spec.gameType !== "shooter" && !isExploration)
          object.mesh.position.z += speedFactor * dt;
        if (
          spec.gameType === "shooter" &&
          ["asteroid", "drone", "sentinel"].includes(object.kind)
        ) {
          object.mesh.position.z += dt * (1.4 + distance * 0.0008);
          const hit = projectiles.find(
            (shot) =>
              Math.abs(shot.mesh.position.x - object.mesh.position.x) < 1 &&
              Math.abs(shot.mesh.position.z - object.mesh.position.z) < 1.5,
          );
          if (hit) {
            object.consumed = true;
            object.mesh.visible = false;
            hit.mesh.visible = false;
            kills++;
            score += spec.scoring.enemyPoints;
            continue;
          }
          if (
            object.mesh.position.z > -0.7 &&
            Math.abs(object.mesh.position.x - player.position.x) < 1.1
          ) {
            object.mesh.position.z = -700;
            health--;
            if (health <= 0) {
              finish(false);
              break;
            }
            continue;
          }
        }
        const close =
          Math.abs(object.mesh.position.z - player.position.z) <
          spec.physics.collisionRadius + (isExploration ? 0.6 : 0.45);
        const aligned =
          Math.abs(object.mesh.position.x - player.position.x) <
          spec.physics.collisionRadius + (isRacing ? 0.45 : 0.25);
        if (close && aligned) {
          if (["coin", "fuel", "crystal", "star"].includes(object.kind)) {
            object.consumed = true;
            object.mesh.visible = false;
            if (object.kind === "fuel" && isRacing)
              fuel = Math.min(spec.mechanics.fuelCapacity, fuel + 24);
            else score += spec.scoring.collectiblePoints;
          } else if (isExploration && object.kind === "platform") {
            const platformTop = object.mesh.position.y + 0.19;
            if (jumpVelocity <= 0 && player.position.y >= platformTop - 0.55) {
              player.position.y = platformTop;
              adventureGround = platformTop;
              activePlatformZ = object.mesh.position.z;
              jumpVelocity = 0;
              object.consumed = true;
            }
          } else {
            if (!(spec.gameType === "runner" && player.position.y > 0.75)) {
              health--;
              object.consumed = true;
              object.mesh.visible = false;
              if (health <= 0) {
                finish(false);
                break;
              }
            }
          }
        }
        if (object.mesh.position.z > 10 && isExploration) object.consumed = true;
      }
      const outcome = evaluateThreeGameOutcome(spec, {
        distance,
        health,
        fuel,
        kills,
        collectibles: objects.filter(
          (o) => ["coin", "crystal", "star"].includes(o.kind) && o.consumed,
        ).length,
        victories: fightingProgress?.wins ?? 0,
      });
      if (outcome === "completed") finish(true);
      else if (outcome === "failed") finish(false);
      for (let i = projectiles.length - 1; i >= 0; i--) {
        const shot = projectiles[i];
        if (shot.mesh.position.z < -650 || !shot.mesh.visible) {
          world.remove(shot.mesh);
          shot.mesh.geometry.dispose();
          (shot.mesh.material as InstanceType<typeof THREE.MeshStandardMaterial>).dispose();
          projectiles.splice(i, 1);
        }
      }
      animateEnvironment(elapsed, distance);
      const chaseDistance =
        spec.gameType === "shooter"
          ? spec.camera.followDistance * 0.75
          : spec.camera.followDistance;
      const target = new THREE.Vector3(
        player.position.x * 0.55,
        spec.camera.height + player.position.y * 0.25,
        player.position.z + chaseDistance,
      );
      camera.position.lerp(target, 1 - Math.exp(-dt * (isRacing ? 3.2 : 4.5)));
      const lookAhead = spec.gameType === "shooter" ? -14 : isExploration ? -5 : -9;
      camera.lookAt(
        player.position.x * 0.35,
        0.8 + (spec.gameType === "runner" ? player.position.y * 0.18 : 0),
        player.position.z + lookAhead,
      );
      renderer.render(scene, camera);
      emit(ended ? finalStatus : "playing");
      if (active) raf = requestAnimationFrame(frame);
    } catch (error) {
      active = false;
      ended = true;
      finalStatus = "failed";
      runtimeError = "The game runtime stopped unexpectedly. Restart to retry.";
      cancelAnimationFrame(raf);
      console.error("[games] 3D runtime frame failed", error);
      emit("failed", true);
    }
  };
  const resize = () => {
    const width = Math.max(1, host.clientWidth),
      height = Math.max(1, host.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };
  const setQuality = (next: GraphicsQuality) => {
    qualitySetting = next;
    renderer.setPixelRatio(getQualityPixelRatio(window.devicePixelRatio, next));
    renderer.shadowMap.enabled = next === "high";
    keyLight.castShadow = next === "high";
    scene.traverse((item) => {
      const mesh = item as InstanceType<typeof THREE.Mesh>;
      if (mesh.isMesh) {
        mesh.castShadow = next === "high";
        mesh.receiveShadow = next === "high";
      }
    });
    renderer.shadowMap.needsUpdate = true;
    resize();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  resize();
  const keyMap: Record<string, Game3DAction> = {
    ArrowLeft: "left",
    KeyA: "left",
    ArrowRight: "right",
    KeyD: "right",
    Space: isFighting ? "dodge" : "jump",
    ArrowUp: "up",
    KeyW: "up",
    ArrowDown: "down",
    KeyS: "down",
    Enter: "accelerate",
    ShiftLeft: "brake",
    KeyJ: isFighting ? "punch" : "fire",
  };
  if (isFighting) {
    keyMap.KeyK = "kick";
    keyMap.KeyL = "web";
  }
  const keydown = (event: KeyboardEvent) => {
    const action = keyMap[event.code];
    if (action) {
      const wasPressed = inputs.has(action);
      inputs.add(action);
      if (!wasPressed) playSound(action);
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"].includes(event.code))
        event.preventDefault();
    }
  };
  const keyup = (event: KeyboardEvent) => {
    const action = keyMap[event.code];
    if (action) inputs.delete(action);
  };
  renderer.domElement.addEventListener("keydown", keydown);
  renderer.domElement.addEventListener("keyup", keyup);
  renderer.domElement.addEventListener("pointerdown", () => renderer.domElement.focus());
  const visibility = () => {
    if (document.hidden && active) {
      active = false;
      cancelAnimationFrame(raf);
      emit("paused");
    }
  };
  document.addEventListener("visibilitychange", visibility);
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    active = false;
    cancelAnimationFrame(raf);
    resizeObserver.disconnect();
    if (audioContext)
      void audioContext
        .close()
        .catch((error: unknown) => console.warn("[games] Audio context cleanup failed", error));
    renderer.domElement.removeEventListener("keydown", keydown);
    renderer.domElement.removeEventListener("keyup", keyup);
    document.removeEventListener("visibilitychange", visibility);
    scene.traverse((item) => {
      const object = item as InstanceType<typeof THREE.Mesh>;
      if (object.geometry) object.geometry.dispose();
      if (object.material)
        for (const material of Array.isArray(object.material) ? object.material : [object.material])
          material.dispose();
    });
    renderer.dispose();
    renderer.forceContextLoss();
    host.replaceChildren();
  };
  reset(false);
  return {
    action(action, pressed) {
      const wasPressed = inputs.has(action);
      if (pressed) inputs.add(action);
      else inputs.delete(action);
      if (pressed && !wasPressed) playSound(action);
    },
    start() {
      if (!disposed && !ended && !active) {
        active = true;
        clock.start();
        emit("playing", true);
        raf = requestAnimationFrame(frame);
      }
    },
    pause() {
      if (active) {
        active = false;
        cancelAnimationFrame(raf);
        emit("paused");
      }
    },
    resume() {
      if (!disposed && !ended && !active) {
        active = true;
        clock.start();
        emit("playing");
        raf = requestAnimationFrame(frame);
      }
    },
    restart() {
      if (!disposed) reset();
    },
    setQuality,
    setSuit(suitKey) {
      if (
        !fightingSpec ||
        !fightingProgress ||
        !canSelectFightingSuit(fightingSpec, fightingProgress.wins, suitKey)
      )
        return;
      fightingProgress = createFightingProgress(fightingSpec, fightingProgress.wins, suitKey);
      applyFightingSuit();
      emit(ended ? finalStatus : "playing", true);
    },
    dispose,
  };
}

function makePlayer(THREE: typeof import("three"), type: Game3DSpec["gameType"], accent: number) {
  const group = new THREE.Group();
  if (type === "fighting") return makeFighterModel(THREE, true, accent);
  const body = new THREE.MeshStandardMaterial({
    color:
      type === "rally" || type === "racing" ? 0xe84b3c : type === "shooter" ? 0x6bdff3 : accent,
    roughness: 0.58,
    metalness: type === "rally" || type === "racing" ? 0.28 : 0.08,
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x18202a, roughness: 0.75 });
  if (type === "rally" || type === "racing") {
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.46, 2.25), body);
    chassis.position.y = 0.62;
    chassis.castShadow = true;
    group.add(chassis);
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.05, 0.56, 1.05),
      new THREE.MeshPhysicalMaterial({
        color: 0x8be7f5,
        metalness: 0.2,
        roughness: 0.18,
        transmission: 0.12,
      }),
    );
    cabin.position.set(0, 1.08, -0.12);
    cabin.castShadow = true;
    group.add(cabin);
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.12, 0.26), dark);
    spoiler.position.set(0, 1.16, 0.94);
    group.add(spoiler);
    const headlight = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.12, 0.08),
      new THREE.MeshBasicMaterial({ color: 0xfff1b5 }),
    );
    headlight.position.set(0, 0.72, -1.16);
    group.add(headlight);
    for (const x of [-0.78, 0.78])
      for (const z of [-0.72, 0.72]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.2, 10), dark);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(x, 0.37, z);
        group.add(wheel);
      }
  } else if (type === "shooter") {
    const hull = new THREE.Mesh(new THREE.ConeGeometry(0.68, 2.25, 5), body);
    hull.rotation.x = -Math.PI / 2;
    hull.position.y = 0.72;
    group.add(hull);
    for (const x of [-0.95, 0.95]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 0.75), dark);
      wing.position.set(x, 0.65, 0.28);
      group.add(wing);
    }
    const cockpit = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 10, 8),
      new THREE.MeshStandardMaterial({
        color: 0x9beeff,
        emissive: 0x1386aa,
        emissiveIntensity: 0.8,
        metalness: 0.55,
        roughness: 0.2,
      }),
    );
    cockpit.scale.set(0.8, 0.55, 1.3);
    cockpit.position.set(0, 0.96, -0.22);
    group.add(cockpit);
    for (const x of [-0.38, 0.38]) {
      const thruster = new THREE.Mesh(
        new THREE.ConeGeometry(0.13, 0.7, 8),
        new THREE.MeshBasicMaterial({ color: 0x53dfff }),
      );
      thruster.rotation.x = Math.PI / 2;
      thruster.position.set(x, 0.63, 1.14);
      group.add(thruster);
    }
  } else {
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.75, 3, 6), body);
    torso.position.y = 1.05;
    group.add(torso);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xf2c6a1, roughness: 0.8 }),
    );
    head.position.y = 1.72;
    group.add(head);
    for (const x of [-0.2, 0.2]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.62, 0.22), dark);
      leg.position.set(x, 0.32, 0);
      group.add(leg);
    }
  }
  return group;
}

function makeFighterModel(THREE: typeof import("three"), hero: boolean, accent: number) {
  const group = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({
    color: hero ? accent : 0x675064,
    roughness: 0.58,
    metalness: 0.12,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: hero ? 0x162335 : 0x28212e,
    roughness: 0.78,
  });
  const skin = new THREE.MeshStandardMaterial({
    color: hero ? 0x182033 : 0x9e6857,
    roughness: 0.85,
  });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.43, 0.78, 4, 8), suit);
  torso.position.y = 1.3;
  torso.userData.suitAccent = hero;
  torso.castShadow = true;
  group.add(torso);
  const chest = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 8, 6),
    new THREE.MeshStandardMaterial({
      color: hero ? 0xe85265 : 0x9a7760,
      emissive: hero ? 0x37101a : 0x120c08,
      emissiveIntensity: 0.35,
    }),
  );
  chest.scale.set(0.8, 1.1, 0.32);
  chest.position.set(0, 1.48, -0.38);
  group.add(chest);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 9), hero ? dark : skin);
  head.scale.set(0.88, 1.08, 0.9);
  head.position.y = 2.12;
  head.castShadow = true;
  group.add(head);
  if (hero) {
    const eyeMaterial = new THREE.MeshStandardMaterial({
      color: 0xe8fbff,
      emissive: 0x4099bd,
      emissiveIntensity: 0.32,
      roughness: 0.24,
    });
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.095, 8, 6), eyeMaterial);
      eye.scale.set(1.25, 0.72, 0.38);
      eye.position.set(side * 0.14, 2.17, -0.286);
      group.add(eye);
    }
    // Four short embossed lines and a center mark form an original web-creature emblem.
    const emblemMaterial = new THREE.MeshStandardMaterial({
      color: 0xf16b76,
      emissive: 0x641b29,
      emissiveIntensity: 0.4,
      metalness: 0.3,
      roughness: 0.38,
    });
    for (const side of [-1, 1])
      for (const offset of [-1, 1]) {
        const leg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.025, 0.045, 0.36, 5),
          emblemMaterial,
        );
        leg.position.set(side * (0.11 + (offset > 0 ? 0.04 : 0)), 1.49 + offset * 0.09, -0.48);
        leg.rotation.z = side * (0.55 + offset * 0.12);
        group.add(leg);
      }
  } else {
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.38, 0.095, 0.08),
      new THREE.MeshStandardMaterial({
        color: 0xffa66c,
        emissive: 0x71280d,
        emissiveIntensity: 0.45,
      }),
    );
    visor.position.set(0, 2.12, -0.3);
    group.add(visor);
  }
  const limbs: InstanceType<typeof THREE.Mesh>[] = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.46, 3, 6), suit);
    arm.position.set(side * 0.58, 1.38, -0.02);
    arm.rotation.z = side * -0.16;
    arm.castShadow = true;
    group.add(arm);
    limbs.push(arm);
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), dark);
    glove.position.set(side * 0.62, 0.99, -0.03);
    group.add(glove);
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.45, 3, 6), dark);
    leg.position.set(side * 0.22, 0.43, 0.02);
    leg.castShadow = true;
    group.add(leg);
    limbs.push(leg);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.15, 0.42), dark);
    boot.position.set(side * 0.22, 0.1, -0.1);
    group.add(boot);
  }
  group.userData.limbs = limbs;
  return group;
}

function addFightingArena(
  THREE: typeof import("three"),
  world: InstanceType<typeof THREE.Group>,
  visual: VisualPalette,
) {
  const arena = new THREE.Mesh(
    new THREE.CylinderGeometry(12, 12.4, 0.38, 48),
    new THREE.MeshStandardMaterial({ color: 0x33394a, roughness: 0.72, metalness: 0.12 }),
  );
  arena.position.set(0, -0.08, -2);
  arena.receiveShadow = true;
  world.add(arena);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(10.4, 0.12, 8, 64),
    new THREE.MeshStandardMaterial({
      color: visual.accent,
      emissive: visual.accent,
      emissiveIntensity: 0.4,
      metalness: 0.3,
      roughness: 0.35,
    }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.set(0, 0.02, -2);
  world.add(ring);
  for (const x of [-10, 10])
    for (const z of [-10, 6]) {
      const pillar = new THREE.Group();
      const column = new THREE.Mesh(
        new THREE.CylinderGeometry(0.34, 0.48, 6.5, 8),
        new THREE.MeshStandardMaterial({ color: 0x3d4353, roughness: 0.8 }),
      );
      column.position.y = 3.25;
      column.castShadow = true;
      pillar.add(column);
      const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(0.24, 8, 6),
        new THREE.MeshBasicMaterial({ color: visual.accent }),
      );
      lamp.position.y = 6.65;
      pillar.add(lamp);
      pillar.position.set(x, 0, z);
      world.add(pillar);
    }
}

type VisualPalette = {
  sky: number;
  ground: number;
  key: number;
  fog: number;
  accent: number;
  road: number;
  distant: number;
};

export function getVisualPalette(THREE: typeof import("three"), spec: Game3DSpec): VisualPalette {
  spec = Game3DSpecSchema.parse(spec);
  const palettes: Record<Game3DSpec["environmentPreset"], VisualPalette> = {
    city: {
      sky: 0x111b36,
      ground: 0x17202c,
      key: 0x8db7ff,
      fog: 0x34425a,
      accent: 0x35e5ff,
      road: 0x202536,
      distant: 0x3f4265,
    },
    "jungle-temple": {
      sky: 0x253c38,
      ground: 0x263f30,
      key: 0xffd394,
      fog: 0x66755b,
      accent: 0x9cf28b,
      road: 0x55513a,
      distant: 0x3e6650,
    },
    "desert-dunes": {
      sky: 0x8d5941,
      ground: 0xa97848,
      key: 0xffd293,
      fog: 0xc29464,
      accent: 0xffdd83,
      road: 0x51483e,
      distant: 0xd7a66b,
    },
    "space-nebula": {
      sky: 0x08091f,
      ground: 0x10142c,
      key: 0x9a9eff,
      fog: 0x30264f,
      accent: 0x78edff,
      road: 0x171b35,
      distant: 0x622e82,
    },
    "mountain-pass": {
      sky: 0x637e9b,
      ground: 0x455253,
      key: 0xffedc4,
      fog: 0x94a9a8,
      accent: 0xe8d693,
      road: 0x393e3d,
      distant: 0x526a70,
    },
    "ancient-ruins": {
      sky: 0x5a6a62,
      ground: 0x554b3d,
      key: 0xffd59a,
      fog: 0x99906e,
      accent: 0xe9c872,
      road: 0x66553f,
      distant: 0x77714e,
    },
  };
  const visual = palettes[spec.environmentPreset];
  const timeTint: Record<Game3DSpec["timeOfDay"], number> = {
    night: 0x8995c5,
    dawn: 0xffbc8a,
    day: 0xffffff,
    sunset: 0xff9b66,
    "deep-space": 0x9b96ff,
  };
  const lightTint: Record<Game3DSpec["lightingPreset"], number> = {
    "neon-night": 0x90aaff,
    "golden-hour": 0xffc27a,
    overcast: 0xc4d4dd,
    moonlit: 0x92b9ff,
    "deep-space": 0x958bff,
  };
  return {
    ...visual,
    key: new THREE.Color(visual.key)
      .multiply(new THREE.Color(timeTint[spec.timeOfDay]))
      .multiply(new THREE.Color(lightTint[spec.lightingPreset]))
      .getHex(),
    accent:
      spec.palette === "neon"
        ? PALETTES.neon.accent
        : spec.palette === "desert"
          ? PALETTES.desert.accent
          : spec.palette === "jungle"
            ? PALETTES.jungle.accent
            : spec.palette === "ancient"
              ? PALETTES.ancient.accent
              : PALETTES.space.accent,
  };
}

function buildEnvironment(
  THREE: typeof import("three"),
  world: InstanceType<typeof THREE.Group>,
  spec: Game3DSpec,
  visual: VisualPalette,
  quality: GraphicsQuality,
) {
  const isRacing = isRacingGame(spec);
  const isExploration = isExplorationGame(spec);
  const isSpace = spec.environmentPreset === "space-nebula";
  if (!isSpace) {
    const terrainGeometry = new THREE.PlaneGeometry(70, 700, 14, 48);
    const terrainPositions = terrainGeometry.attributes.position;
    for (let i = 0; i < terrainPositions.count; i++) {
      const z = terrainPositions.getY(i);
      const x = terrainPositions.getX(i);
      const rolling =
        Math.sin(z * 0.035 + spec.seed) *
        Math.cos(x * 0.19 + spec.seed) *
        (spec.terrainStyle === "stone"
          ? 0.8
          : spec.terrainStyle === "sand"
            ? 0.4
            : spec.terrainStyle === "grass"
              ? 0.28
              : 0.1);
      terrainPositions.setZ(i, rolling);
    }
    terrainGeometry.attributes.position.needsUpdate = true;
    terrainGeometry.computeVertexNormals();
    const terrain = new THREE.Mesh(
      terrainGeometry,
      new THREE.MeshStandardMaterial({ color: visual.ground, roughness: 0.94, metalness: 0.02 }),
    );
    terrain.rotation.x = -Math.PI / 2;
    terrain.position.set(0, -0.18, -300);
    world.add(terrain);
    const pathWidth = isRacing ? 10 : isExploration ? 4.8 : spec.gameType === "fighting" ? 26 : 8;
    const roadMaterial = new THREE.MeshStandardMaterial({
      color: visual.road,
      roughness: spec.environmentPreset === "city" ? 0.42 : 0.84,
      metalness: spec.environmentPreset === "city" ? 0.24 : 0.03,
    });
    const road = new THREE.Mesh(new THREE.BoxGeometry(pathWidth, 0.16, 700), roadMaterial);
    road.position.set(0, -0.04, -300);
    road.receiveShadow = true;
    world.add(road);
  }
  const count = getEnvironmentAssetCount(spec.assetDensity, spec.environmentPreset, quality);
  const rand = (n: number) => {
    const value = Math.sin((n + spec.seed) * 127.1) * 43758.5453;
    return value - Math.floor(value);
  };
  const animated: Array<{
    mesh: InstanceType<typeof THREE.Object3D>;
    phase: number;
    baseY: number;
  }> = [];
  const shared = (
    geometry: InstanceType<typeof THREE.BoxGeometry>,
    color: number,
    roughness = 0.86,
    metalness = 0.02,
  ) => new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness, metalness }));
  const treeGeometry = new THREE.ConeGeometry(0.9, 2.8, 7);
  const trunkGeometry = new THREE.CylinderGeometry(0.16, 0.24, 1.2, 6);
  const rockGeometry = new THREE.DodecahedronGeometry(1.2, 0);
  const buildingGeometry = new THREE.BoxGeometry(1.8, 1, 1.6);
  const stoneGeometry = new THREE.BoxGeometry(2.4, 4.5, 1.1);
  const materials = {
    leaf: new THREE.MeshStandardMaterial({
      color: spec.vegetationStyle === "cacti" ? 0x527d48 : 0x2f7453,
      roughness: 0.95,
    }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x574331, roughness: 1 }),
    rock: new THREE.MeshStandardMaterial({ color: visual.distant, roughness: 0.94 }),
    stone: new THREE.MeshStandardMaterial({ color: 0x857459, roughness: 0.92 }),
    glow: new THREE.MeshBasicMaterial({ color: visual.accent }),
  };
  const add = (
    mesh: InstanceType<typeof THREE.Mesh>,
    x: number,
    y: number,
    z: number,
    scale = 1,
  ) => {
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(scale);
    mesh.castShadow = quality === "high";
    mesh.receiveShadow = quality === "high";
    world.add(mesh);
    return mesh;
  };
  const useArchitecture =
    spec.architectureStyle !== "none" ||
    ["city", "jungle-temple", "ancient-ruins"].includes(spec.environmentPreset);
  const templeArchitecture =
    spec.architectureStyle === "temple" ||
    spec.environmentPreset === "ancient-ruins" ||
    spec.environmentPreset === "jungle-temple";
  const cityArchitecture =
    spec.architectureStyle === "neon-city" || spec.environmentPreset === "city";
  if (isSpace) {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (rand(i + 99) - 0.5) * 55;
      positions[i * 3 + 1] = (rand(i + 77) - 0.25) * 28;
      positions[i * 3 + 2] = -18 - rand(i * 3 + 1) * 640;
    }
    const starsGeometry = new THREE.BufferGeometry();
    starsGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    world.add(
      new THREE.Points(
        starsGeometry,
        new THREE.PointsMaterial({ color: 0xddeaff, size: 2, sizeAttenuation: true }),
      ),
    );
  }
  for (let i = 0; i < count; i++) {
    const side = i % 2 ? 1 : -1;
    const z = -18 - rand(i * 3 + 1) * 640;
    const x =
      side * (5.2 + rand(i * 3 + 2) * (spec.environmentPreset === "space-nebula" ? 28 : 10));
    if (isSpace) continue;
    if (spec.vegetationStyle !== "none" || spec.environmentPreset === "jungle-temple") {
      const scale = 0.65 + rand(i + 9) * 1.5;
      if (spec.vegetationStyle === "cacti") {
        const cactus = add(
          new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, 2.6, 7), materials.leaf),
          x,
          1.1 * scale,
          z,
          scale,
        );
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.9, 6), materials.leaf);
        arm.rotation.z = Math.PI / 2;
        arm.position.set(0.3, 0.1, 0);
        cactus.add(arm);
      } else {
        const trunk = add(new THREE.Mesh(trunkGeometry, materials.trunk), x, 0.6 * scale, z, scale);
        const canopy = new THREE.Mesh(treeGeometry, materials.leaf);
        canopy.position.y = 1.8;
        trunk.add(canopy);
        if (spec.environmentPreset === "jungle-temple")
          animated.push({ mesh: canopy, phase: i, baseY: 1.8 });
      }
    }
    if (useArchitecture && i % 3 === 0) {
      const height = 3 + rand(i + 5) * (cityArchitecture ? 13 : 3.5);
      const geometry = templeArchitecture ? stoneGeometry : buildingGeometry;
      const structure = new THREE.Mesh(
        geometry,
        cityArchitecture
          ? new THREE.MeshStandardMaterial({
              color: i % 2 ? 0x30385b : 0x4a315c,
              roughness: 0.38,
              metalness: 0.34,
            })
          : materials.stone,
      );
      structure.scale.y = height / (cityArchitecture ? 1 : 4.5);
      add(structure, x * 1.55, height / 2 - 0.05, z, 1.1 + rand(i + 6));
      if (cityArchitecture) {
        const sign = add(
          new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.22, 0.1), materials.glow),
          x * 1.55,
          height * 0.62,
          z - 0.84,
          1,
        );
        animated.push({ mesh: sign, phase: i, baseY: sign.position.y });
      } else if (templeArchitecture && i % 2 === 0) {
        const cap = new THREE.Mesh(new THREE.ConeGeometry(1.55, 0.9, 4), materials.stone);
        cap.position.y = 2.65;
        structure.add(cap);
      }
    } else if (i % 2 === 0) {
      const rock = new THREE.Mesh(rockGeometry, materials.rock);
      rock.rotation.set(rand(i + 15), rand(i + 17), rand(i + 21));
      add(
        rock,
        x,
        0.1,
        z,
        0.5 + rand(i + 12) * (spec.environmentPreset === "mountain-pass" ? 4 : 1.4),
      );
    }
  }
  if (!isSpace) {
    if (!isExploration && spec.gameType !== "fighting")
      for (const x of [isRacing ? -5.15 : -4.15, isRacing ? 5.15 : 4.15]) {
        const edge = shared(new THREE.BoxGeometry(0.18, 0.22, 700), visual.accent, 0.5, 0.22);
        add(edge, x, 0.08, -300);
      }
    if (isExploration) {
      const steppingStones = new THREE.InstancedMesh(
        new THREE.DodecahedronGeometry(1, 0),
        new THREE.MeshStandardMaterial({ color: 0x8b806d, roughness: 0.95 }),
        42,
      );
      const stone = new THREE.Object3D();
      for (let i = 0; i < 42; i++) {
        stone.position.set(Math.sin(i * 1.7) * 0.55, -0.01, -8 - i * 16);
        stone.rotation.y = i * 0.39;
        stone.scale.set(1.15, 0.12, 1.6);
        stone.updateMatrix();
        steppingStones.setMatrixAt(i, stone.matrix);
      }
      world.add(steppingStones);
    } else {
      const dashCount = 36;
      const dashes = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.12, 0.025, 5.2),
        new THREE.MeshStandardMaterial({ color: 0xd9d7c7, roughness: 0.72 }),
        dashCount,
      );
      const marker = new THREE.Object3D();
      for (let i = 0; i < dashCount; i++) {
        marker.position.set(0, 0.055, -12 - i * 18);
        marker.updateMatrix();
        dashes.setMatrixAt(i, marker.matrix);
      }
      world.add(dashes);
    }
  } else {
    const nebula = new THREE.Mesh(
      new THREE.SphereGeometry(34, 12, 8),
      new THREE.MeshBasicMaterial({
        color: visual.distant,
        transparent: true,
        opacity: 0.16,
        side: THREE.BackSide,
      }),
    );
    add(nebula, 0, 4, -105, 1);
  }
  let dust: InstanceType<typeof THREE.Points> | null = null;
  if (spec.particleIntensity > 0.02) {
    const amount = Math.round(18 + spec.particleIntensity * 54);
    const positions = new Float32Array(amount * 3);
    for (let i = 0; i < amount; i++) {
      positions[i * 3] = (rand(i + 401) - 0.5) * 26;
      positions[i * 3 + 1] = 0.5 + rand(i + 402) * 7;
      positions[i * 3 + 2] = -rand(i + 403) * 180;
    }
    const dustGeometry = new THREE.BufferGeometry();
    dustGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    dust = new THREE.Points(
      dustGeometry,
      new THREE.PointsMaterial({
        color: visual.accent,
        size: spec.particleIntensity > 0.7 ? 0.11 : 0.07,
        transparent: true,
        opacity: Math.min(0.45, spec.particleIntensity * 0.42),
        depthWrite: false,
      }),
    );
    world.add(dust);
  }
  if (isRacing && !isSpace) {
    // Alternating, per-instance curb colors give the rally track readable rumble strips in one draw call.
    const curbCount = 56;
    const curbs = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.48, 0.14, 4),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86 }),
      curbCount,
    );
    const curb = new THREE.Object3D();
    for (let i = 0; i < curbCount; i++) {
      const segment = Math.floor(i / 2);
      curb.position.set(i % 2 ? 5.18 : -5.18, 0.04, -8 - segment * 24);
      curb.updateMatrix();
      curbs.setMatrixAt(i, curb.matrix);
      curbs.setColorAt(i, segment % 2 ? new THREE.Color(0xe8e2d2) : new THREE.Color(0xc64d43));
    }
    world.add(curbs);
  }
  return (time: number, distance: number) => {
    for (const item of animated) {
      item.mesh.rotation.z = Math.sin(time * 1.4 + item.phase) * 0.035;
      item.mesh.position.y = item.baseY + Math.sin(time * 1.2 + item.phase) * 0.025;
    }
    if (dust) {
      dust.position.y = Math.sin(time * 0.45) * 0.14;
      dust.position.z = spec.gameType === "shooter" ? -(distance % 180) : 0;
    }
  };
}
