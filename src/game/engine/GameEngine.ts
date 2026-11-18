/**
 * GameEngine — the boundary between React and the Babylon.js simulation.
 *
 * React creates one engine per practice session, subscribes to throttled HUD snapshots and
 * discrete events, and calls a small imperative API (start/resume/pause/end/updateSettings).
 * The game loop (input → physics → weapons → bots → render) runs independently of React.
 */

import type {
  EngineStatus,
  GameSettings,
  HudState,
  KillFeedEntry,
  PauseInfo,
  PracticeConfig,
  SessionStats,
  Vec3,
  WeaponId,
} from '../../types';
import { AudioEngine, stepSound, type StepSurface } from '../audio/AudioEngine';
import { encodeWav, renderAllGuns } from '../audio/gunSynth';
import { Bot, type BotContext } from '../bots/Bot';
import { BotAssets, BotVisual } from '../bots/BotVisual';
import { AGENTS, getAgent, type AgentId } from '../agents';
import type { AgentAssets } from '../bots/AgentVisual';
import type { WeaponSkin } from '../weapons/WeaponSkins';
import { ArmsTemplate } from '../weapons/FirstPersonArms';
import { PeekBehavior } from '../bots/behaviors/PeekBehavior';
import { BOT_SCALE, visibleSampleCount } from '../bots/perception/visibility';
import { Input } from '../core/Input';
import { drawCrosshair } from '../hud/crosshairRenderer';
import { Minimap } from '../hud/Minimap';
import { buildMapData, findLocation, mapMood, type MapData } from '../maps/MapData';
import { getMapDefinition } from '../maps/registry';
import { COL_BULLET, humanoidHitboxes, rayHumanoid, type HitZone } from '../physics/CollisionWorld';
import { PlayerController, RUN_SPEED } from '../player/PlayerController';
import { MODE_LABELS, PracticeDirector } from '../practice/PracticeDirector';
import { avg, pct, SessionTracker } from '../practice/SessionTracker';
import { SprayTrainer } from '../practice/SprayTrainer';
import { drawSprayPanel } from '../hud/sprayPanel';
import {
  Camera,
  Color3,
  CreateBox,
  CreateCylinder,
  TransformNode,
  Mesh,
  StandardMaterial,
  Color4,
  ColorCurves,
  DirectionalLight,
  FreeCamera,
  FxaaPostProcess,
  HemisphericLight,
  PointLight,
  RenderTargetTexture,
  Scene,
  ShadowGenerator,
  Vector3,
  type AbstractEngine,
} from '../rendering/babylon';
import { Effects, surfaceKind } from '../rendering/Effects';
import { SPIKE_FUSE, type Spike } from '../practice/PracticeDirector';
import { renderMap, type MapRenderResult } from '../rendering/MapRenderer';
import { muzzleFlashTexture, radialTexture, setTextureQuality } from '../rendering/textures';
import { ViewModel } from '../weapons/ViewModel';
import { damageAt, recoilAt, WEAPONS } from '../weapons/weaponConfigs';
import { BOLT_CYCLE, WeaponSystem, type ShotInfo } from '../weapons/WeaponSystem';
import { enterGameFullscreen } from '../../utils/fullscreen';
import { acquireRenderHost, releaseRenderHost, webglAvailable } from './RenderHost';
import type { BotView } from '../bots/BotVisual';
import { RemoteTrack, ServerClock } from '../net/Interpolation';
import type { NetLink } from '../net/NetLink';
import { Prediction } from '../net/Prediction';
import { actionMask, captureMasks, type Command } from '../../net/command';
import { INPUT_RATE, INTERP_DELAY_MS, PF_ALIVE, type MatchEvent, type ServerMessage } from '../../net/protocol';

const DEG = Math.PI / 180;
const BASE_HFOV = 103 * DEG;
const SIM_STEP = 1 / 120;
/** How many agent models practice loads for its bots (each bot wears one of them at random). */
const PRACTICE_AGENTS = 3;

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
/**
 * Distance haze (exponential-squared fog in the map's pale haze colour). Scenery is untouched up
 * close, about a fifth washed out at 45 m and nearly half at 70 m. Characters are left out of it
 * (`applyFog = false` on their meshes), so a far enemy stays at full colour against a softened
 * background instead of blending into it.
 */
const HAZE_DENSITY = 0.011;

/** True when running inside an iframe (pointer lock may be disallowed by the embedder's sandbox). */
function isEmbedded(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true; // cross-origin parent
  }
}

export type EngineEvent =
  | { type: 'status'; status: EngineStatus; pause?: PauseInfo }
  | { type: 'hud'; hud: HudState }
  | { type: 'killfeed'; entry: KillFeedEntry }
  | { type: 'ended'; stats: SessionStats }
  /** Multiplayer: the server put new guns in the player's hands (a change made mid-life arrives at the respawn). */
  | { type: 'loadout'; loadout: { primary: WeaponId; secondary: WeaponId } }
  | { type: 'notice'; message: string | null }
  | { type: 'error'; message: string };

export interface EngineOptions {
  /** Element the shared 3D canvas is mounted into (first child, under the overlay). */
  container: HTMLElement;
  overlay: HTMLCanvasElement;
  config: PracticeConfig;
  settings: GameSettings;
  /** Multiplayer: the connection to the match. The session then has no bots and never pauses the world. */
  net?: NetLink;
}

/** Another player in a multiplayer match, as drawn here. */
interface RemotePlayer {
  track: RemoteTrack;
  visual: BotView;
  stepTimer: number;
  /** For the footstep voice, so two players' steps can be told apart. */
  voice: number;
  /** Seconds left on the minimap after firing an unsuppressed gun (0 = not shown). */
  revealed: number;
  /** The gun the model is showing, or is about to once its model has loaded. */
  weapon: WeaponId;
  /** The agent the body is dressed as (null until the server has said). */
  agent: string | null;
  /** Visual id, kept when the body is rebuilt for another agent. */
  n: number;
  /** The body is the agent's model (not the blocky stand-in). */
  model: boolean;
  /** Down (a body built now must start dead). */
  dead: boolean;
}

/** How long a player who fired an unsuppressed gun stays on everyone's minimap. */
const FIRE_REVEAL_SEC = 2.5;
/** How far away a running enemy's footsteps can be heard (metres): in the open, and with a wall in between. */
const STEP_HEAR_RANGE = 26;
const STEP_HEAR_RANGE_WALLED = 16;
/** How long a heard footstep stays marked on the minimap (seconds). */
const STEP_MARK_SEC = 1.3;

/** The keys that move the player: the only ones a command carries. */
const MOVE_MASK = actionMask(['forward', 'back', 'left', 'right', 'walk', 'crouch']);
const JUMP_MASK = actionMask(['jump']);
/** A correction further than this is a teleport (a respawn), not an error to ease across. */
const SNAP_DISTANCE = 3;

interface DamageIndicator {
  yaw: number;
  t: number;
}

export class GameEngine {
  private engine!: AbstractEngine;
  private scene!: Scene;
  private camera!: FreeCamera;
  private map!: MapData;
  private mapRender!: MapRenderResult;
  private shadow: ShadowGenerator | null = null;
  private fxaa: FxaaPostProcess | null = null;
  private muzzleLight: PointLight | null = null;
  private input!: Input;
  private player!: PlayerController;
  private weapons!: WeaponSystem;
  private viewModel!: ViewModel;
  private effects!: Effects;
  private audio!: AudioEngine;
  private director!: PracticeDirector;
  private tracker!: SessionTracker;
  private botAssets!: BotAssets;
  /** Agent models by agent, once loaded (null: failed, or models are off). */
  private readonly agentModels = new Map<AgentId, Promise<AgentAssets | null>>();
  private readonly agentReady = new Map<AgentId, AgentAssets>();
  /** Multiplayer: visual ids handed to other players' bodies. */
  private remoteSerial = 0;
  private weaponSkins = new Map<WeaponId, WeaponSkin>();
  private armsTemplate: ArmsTemplate | null = null;
  private hitboxMeshes: Mesh[] | null = null;
  private minimap!: Minimap;
  /** Enemy footsteps just heard, for the minimap: where, and when (performance.now()). */
  private heardSteps: { x: number; z: number; at: number }[] = [];
  /** Spray-control mode only. */
  private spray: SprayTrainer | null = null;
  private sprayPattern: { id: WeaponId; points: [number, number][] } | null = null;
  /** Kills since the player's last death (drives the 1–5 kill sounds). */
  private killStreak = 0;
  private ctx!: BotContext;
  /** Multiplayer only (null in practice). */
  private readonly net: NetLink | null;
  private readonly prediction = new Prediction();
  private readonly serverClock = new ServerClock();
  private readonly remotes = new Map<string, RemotePlayer>();
  private netOutbox: Command[] = [];
  private netSendTimer = 0;
  /** What is left of the last correction, eased out of the camera so the view doesn't jump. */
  private netOffset: Vec3 = [0, 0, 0];
  private netSnapshots = 0;
  /** Shots sent and not yet answered, by the command they were fired on (for the statistics of a confirmed hit). */
  private readonly netShots = new Map<number, ShotInfo>();
  /** The gun the server was last told is in this player's hands. */
  private netHeld: WeaponId | null = null;
  /** Gun models being fetched for other players and bots, so each is only asked for once. */
  private readonly skinLoads = new Map<WeaponId, Promise<WeaponSkin | undefined>>();

  status: EngineStatus = 'loading';
  private listeners = new Set<(e: EngineEvent) => void>();
  private settings: GameSettings;
  private config: PracticeConfig;
  private time = 0;
  private elapsed = 0;
  private lastFrame = 0;
  private fps = 60;
  private frameMs = 16;
  /** Debug only: game-time multiplier (0 freezes the simulation; see debug.timeScale). */
  private debugTimeScale = 1;
  private debugSpectate: { index: number; angle: number; dist: number; remote?: boolean } | null = null;
  private boltAge = -1;
  private hudTimer = 0;
  private visTimer = 0;
  private lastHud: HudState | null = null;
  private hitmarker = { t: 0, kind: 'body' as 'body' | 'head' | 'kill' };
  /** Seconds left on the "moving" warning under the crosshair. */
  private moveWarn = 0;
  /** Which foot the player's next step falls on (−1 left, +1 right). */
  private stepFoot = 1;
  private spikeLamp: StandardMaterial | null = null;
  private spikeState: Spike['state'] = 'armed';
  private spikeBeep = 0;
  private spikeBlink = 0;
  private damageIndicators: DamageIndicator[] = [];
  private deathFlash = 0;
  private killFeedId = 1;
  private ended = false;
  private disposed = false;
  private rendererName = 'WebGL2';
  private reloadCues = { out: false, in: false, bolt: false };
  /** A recorded reload is playing, and how far the reload had got (to tell a cancel from a finish). */
  private reloadClip = false;
  private lastReloadProgress = 0;
  /** Adaptive resolution: extra render-scale factor (1 = the user's setting) and its controller state. */
  private dynScale = 1;
  private adaptT = 0;
  private adaptFrames = 0;
  private adaptHold = 0;
  private adaptBackoff = 4;
  private adaptLastUp = -1e9;
  private slowTime = 0;
  private slowWarned = false;
  private drawCallsTotal = 0;
  private drawCallsFrame = 0;
  private canvas!: HTMLCanvasElement;
  private readonly container: HTMLElement;
  private readonly frameFn = () => this.frame();
  private readonly ctxObservers: { remove: () => void }[] = [];
  /** Resolves when the scene is built and shaders are compiled (status 'ready'). */
  readonly ready: Promise<void>;
  private readonly overlay: HTMLCanvasElement;
  private overlayCtx: CanvasRenderingContext2D;
  private readonly onBlur = () => this.pause('blur');
  private readonly onVisibility = () => {
    if (document.hidden) this.pause('hidden');
  };
  private readonly onResize = () => this.resize();
  /** Milliseconds from init start to each loading phase (diagnostics). */
  readonly loadTimings: Record<string, number> = {};

  private constructor(opts: EngineOptions) {
    this.container = opts.container;
    this.overlay = opts.overlay;
    this.settings = opts.settings;
    this.config = { ...opts.config }; // own copy: the weapon menu changes primary/secondary mid-session
    this.net = opts.net ?? null;
    const octx = this.overlay.getContext('2d');
    if (!octx) throw new Error('2D canvas unavailable');
    this.overlayCtx = octx;
    this.ready = this.init();
  }

  get isDisposed() {
    return this.disposed;
  }

  /**
   * Start building a session. Returns at once; await `engine.ready` for the scene.
   * `dispose()` may be called at any time, including while it is still loading.
   */
  static create(opts: EngineOptions): GameEngine {
    const g = new GameEngine(opts);
    return g;
  }

  /* ------------------------------------------------------------------ */
  /* Setup                                                               */
  /* ------------------------------------------------------------------ */

  private async init() {
    const T0 = performance.now();
    const mark = (name: string) => { (this.loadTimings as Record<string, number>)[name] = Math.round(performance.now() - T0); };
    if (!webglAvailable()) throw new Error('WebGL is not available in this browser. Enable hardware acceleration or try Chrome/Edge.');
    // Reuse the shared engine so shaders compiled in earlier sessions stay cached.
    const host = await acquireRenderHost(this, this.settings.graphics.renderer === 'webgpu' ? 'webgpu' : 'webgl2');
    if (this.disposed) {
      releaseRenderHost(this);
      return;
    }
    this.engine = host.engine;
    this.canvas = host.canvas;
    this.rendererName = host.name;
    if (host.fallback) this.emit({ type: 'notice', message: 'WebGPU unavailable here — using WebGL 2.' });
    this.container.insertBefore(this.canvas, this.container.firstChild);
    mark('renderEngine');
    this.engine.disablePerformanceMonitorInBackground = true;
    this.applyResolution();
    this.applyFpsCap();
    setTextureQuality(this.settings.graphics.textureQuality);

    const scene = new Scene(this.engine);
    this.scene = scene;
    scene.skipPointerMovePicking = true;
    scene.constantlyUpdateMeshUnderPointer = false;
    const def = getMapDefinition(this.config.mapId);
    const mood = mapMood(def);
    scene.clearColor = Color4.FromHexString(def.palette.sky[1] + 'ff');
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = HAZE_DENSITY;
    scene.fogColor = Color3.FromHexString(def.palette.fog);
    if (this.settings.graphics.postFx) {
      scene.imageProcessingConfiguration.contrast = 1.22;
      scene.imageProcessingConfiguration.exposure = mood.exposure;
      scene.imageProcessingConfiguration.toneMappingEnabled = true;
      scene.imageProcessingConfiguration.toneMappingType = 1; // ACES
      // a touch more colour than the tone mapper leaves, for the painted look
      const curves = new ColorCurves();
      curves.globalSaturation = mood.saturation;
      scene.imageProcessingConfiguration.colorCurves = curves;
      scene.imageProcessingConfiguration.colorCurvesEnabled = true;
      scene.imageProcessingConfiguration.vignetteEnabled = true;
      scene.imageProcessingConfiguration.vignetteWeight = 0.45;
    } else {
      // low-end: skip the per-pixel grading maths in every material
      scene.imageProcessingConfiguration.isEnabled = false;
    }
    scene.setRenderingAutoClearDepthStencil(1, true, true, true);

    // camera
    const cam = new FreeCamera('player-cam', new Vector3(0, 2, 0), scene);
    cam.minZ = 0.03;
    cam.maxZ = 500;
    cam.fovMode = Camera.FOVMODE_HORIZONTAL_FIXED;
    cam.fov = BASE_HFOV;
    cam.inputs.clear();
    this.camera = cam;

    // lights (created before materials compile/freeze)
    // Stylised daylight: a strong warm sun, cool sky light filling the shadows, warm ground bounce.
    const hemi = new HemisphericLight('hemi', new Vector3(0.2, 1, -0.1), scene);
    const simpleLight = this.settings.graphics.lighting === 'simple';
    // Without shadows the sun reaches everywhere, so lean on the sky light to keep the picture even.
    const lit = this.settings.graphics.shadows === 'off' ? 0.8 : 1;
    hemi.intensity = mood.ambientIntensity * (simpleLight ? 1.25 : 1) * (2 - lit);
    hemi.diffuse = Color3.FromHexString(mood.ambient);
    hemi.groundColor = Color3.FromHexString(mood.bounce);
    hemi.specular = Color3.Black();
    const sun = new DirectionalLight('sun', new Vector3(...mood.sunDir).normalize(), scene);
    sun.position = new Vector3(...mood.sunDir).normalize().scale(-120);
    sun.intensity = mood.sunIntensity * lit;
    sun.diffuse = Color3.FromHexString(mood.sun);
    if (!simpleLight) {
      // faint bounce from the sunlit side so faces turned away from the sun keep their shape
      const fill = new DirectionalLight('fill', new Vector3(-mood.sunDir[0], -0.35, -mood.sunDir[2]).normalize(), scene);
      fill.intensity = 0.22;
      fill.diffuse = Color3.FromHexString(mood.bounce);
      fill.specular = Color3.Black();
      fill.shadowEnabled = false;
    }
    const fx = this.settings.graphics.effects;
    if (fx !== 'low') {
      this.muzzleLight = new PointLight('muzzle-light', new Vector3(0, -100, 0), scene);
      this.muzzleLight.diffuse = Color3.FromHexString('#ffc27a');
      this.muzzleLight.specular = Color3.Black();
      this.muzzleLight.range = 7;
      this.muzzleLight.intensity = 0;
    }

    const shadows = this.settings.graphics.shadows;
    if (shadows !== 'off') {
      const size = shadows === 'high' ? 4096 : 2048;
      const sg = new ShadowGenerator(size, sun);
      sg.usePercentageCloserFiltering = true;
      sg.filteringQuality = shadows === 'high' ? ShadowGenerator.QUALITY_HIGH : ShadowGenerator.QUALITY_MEDIUM;
      sg.bias = 0.0015;
      sg.normalBias = 0.02;
      sg.darkness = 0.12;
      this.shadow = sg;
    }

    // map
    this.map = buildMapData(def);
    this.minimap = new Minimap(this.map);
    mark('mapData');
    this.mapRender = renderMap(scene, this.map, this.shadow);
    mark('mapRender');
    if (this.shadow) {
      const sm = this.shadow.getShadowMap();
      if (sm) sm.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    }

    // gameplay
    this.input = new Input(this.canvas);
    this.input.rawRequested = this.settings.sensitivity.rawInput;
    this.input.onLockChange = (locked) => {
      if (!locked && this.status === 'running' && !this.input.unlockedLook) this.pause('pointer-lock');
    };
    this.input.onEscape = () => this.pause('user');
    this.player = new PlayerController(this.map.world);
    this.player.events = {
      onFootstep: () => {
        // alternate feet a little left and right; the sound follows what is underfoot
        this.stepFoot = -this.stepFoot;
        const surface = this.surfaceUnder(this.player.pos.x, this.player.pos.y, this.player.pos.z);
        this.audio.play(stepSound(surface), { bus: 'foot', volume: 0.6, rate: 0.97 + Math.random() * 0.06, pan: this.stepFoot * 0.14, group: 'step-player' });
        this.director?.hear(this.ctx, this.player.pos.x, this.player.pos.z, 14);
      },
      onJump: () => this.audio.play('jump', { bus: 'foot', volume: 0.5 }),
      onLand: (impact) => {
        const surface = this.surfaceUnder(this.player.pos.x, this.player.pos.y, this.player.pos.z);
        const volume = Math.min(1, 0.55 + impact * 0.07);
        this.audio.play('land', { bus: 'foot', volume });
        this.audio.play(stepSound(surface), { bus: 'foot', volume: volume * 0.8, rate: 0.82, group: 'step-player' });
      },
    };
    this.weapons = new WeaponSystem(this.config.primary, this.config.secondary);
    this.weapons.infiniteAmmo = this.config.infiniteAmmo;
    this.weapons.events = {
      onShot: (s) => this.resolvePlayerShot(s),
      onReloadStart: () => {
        this.reloadCues = { out: false, in: false, bolt: false };
      },
      onEquip: () => this.audio.play('equip', { bus: 'effects', volume: 0.5 }),
      onDryFire: () => this.audio.play('dry', { bus: 'effects', volume: 0.6 }),
    };
    mark('gameplay');
    this.effects = new Effects(scene, fx);
    this.audio = new AudioEngine(this.settings.audio);
    this.botAssets = new BotAssets(
      scene,
      muzzleFlashTexture(scene),
      radialTexture(scene, 'blob', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0)', 64),
    );

    mark('fxBots');

    // Optional local 3D models (public/models): weapon skins and the rigged agent for bots.
    // Each falls back to the built-in simple model if its file is missing or broken.
    let skins = new Map<WeaponId, WeaponSkin>();
    if (__LOCAL_MODELS__) {
      const g = this.settings.graphics;
      // practice bots each wear a random agent from a few loaded up front; multiplayer loads the agents
      // players picked as they show up
      const practiceAgents = g.botModel === 'agent' && !this.net ? shuffled(AGENTS.map((a) => a.id)).slice(0, PRACTICE_AGENTS) : [];
      const wantAgent = g.botModel === 'agent';
      const skinIds: WeaponId[] = g.gunModels === 'skins' ? [this.config.primary, this.config.secondary, ...(wantAgent ? (['vandal'] as WeaponId[]) : [])] : [];
      const failed: string[] = [];
      const [loadedSkins, agents, arms] = await Promise.all([
        skinIds.length
          ? import('../weapons/WeaponSkins').then((m) => m.loadWeaponSkins(scene, skinIds)).catch((err) => {
              console.warn('[weapons] skins unavailable', err);
              failed.push('weapon skins');
              return new Map<WeaponId, WeaponSkin>();
            })
          : Promise.resolve(new Map<WeaponId, WeaponSkin>()),
        Promise.all(practiceAgents.map((a) => this.loadAgent(a))).then((loaded) => {
          if (practiceAgents.length && !loaded.some(Boolean)) failed.push('the agent models');
          return null;
        }),
        // animated arms pack first (if chosen), then the glove-arm model, then the built-in arms
        g.fpArms === 'animated'
          ? ArmsTemplate.loadAnimated(scene).catch((err) => {
              console.warn('[viewmodel] animated arms unavailable — trying the glove-arm model', err);
              return ArmsTemplate.load(scene).catch(() => null);
            })
          : g.fpArms === 'rigged'
            ? ArmsTemplate.load(scene).catch((err) => {
                console.warn('[viewmodel] arm model unavailable — using the built-in arms', err);
                return null;
              })
            : Promise.resolve(null),
      ]);
      void agents;
      if (this.disposed) {
        arms?.dispose();
        for (const k of loadedSkins.values()) k.dispose();
        return;
      }
      skins = loadedSkins;
      this.weaponSkins = loadedSkins;
      this.armsTemplate = arms;
      for (const a of this.agentReady.values()) a.rifle = loadedSkins.get('vandal') ?? null;
      if (failed.length) this.emit({ type: 'notice', message: `Couldn't load ${failed.join(' and ')} — using the simple models.` });
      mark('models');
    }
    // First-person arms: the arm model when it loaded, else the built-in rig (no file needed).
    if (!this.armsTemplate && this.settings.graphics.fpArms !== 'simple') this.armsTemplate = new ArmsTemplate();
    this.viewModel = new ViewModel(scene, cam, [this.config.primary, this.config.secondary], skins, this.armsTemplate);
    this.tracker = new SessionTracker(this.config);
    if (this.config.mode === 'spray') this.spray = new SprayTrainer();
    const location = findLocation(def, this.config.locationId);
    this.director = new PracticeDirector({
      map: this.map,
      location,
      config: this.config,
      tracker: this.tracker,
      createVisual: (id) => {
        const ready = [...this.agentReady.values()];
        return ready.length ? ready[Math.floor(Math.random() * ready.length)].create(id) : new BotVisual(this.botAssets, id);
      },
      // a practice bot's body shows the gun it was really given
      onBotWeapon: (bot) => {
        const weapon = bot.weapon.id;
        this.holdWeapon(() => (bot.weapon.id === weapon ? bot.visual : null), weapon);
      },
      rng: Math.random,
    });

    const sp = this.net ? { pos: this.net.spawn.pos, yaw: this.net.spawn.yaw } : this.director.playerSpawn;
    this.player.spawn(sp.pos[0], sp.pos[1], sp.pos[2], sp.yaw);

    this.ctx = {
      time: 0,
      world: this.map.world,
      map: this.map,
      player: this.player,
      botsShootBack: this.config.botsShootBack || this.config.mode === 'deathmatch' || this.config.mode === 'site-clear' || this.config.mode === 'retake',
      bots: this.director.bots,
      rng: Math.random,
      botFire: (bot, origin, dir) => this.resolveBotShot(bot, origin, dir),
      mayFire: (bot) => this.director.mayFire(bot, this.time),
      graceUntil: 0,
      onBotFootstep: (bot) => {
        // each bot keeps its own slight pitch, so two sets of steps can be told apart
        this.enemyStep(bot.x, bot.y, bot.z, 0.93 + ((bot.id * 37) % 10) * 0.012, `step-bot-${bot.id}`);
      },
    };
    // multiplayer has no bots: the other bodies are players, placed by the server's snapshots
    if (this.net) this.net.onMessage = (msg) => this.onNetMessage(msg);
    else this.director.start(this.ctx);
    if (this.director.spike) this.buildSpike(this.director.spike);
    mark('director');
    if (this.director.unusableSpots.length) {
      console.info('[TAL] spots not visible from this spawn were skipped:', this.director.unusableSpots);
    }

    this.applyAntialias();
    this.updateCamera();

    // robustness hooks
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('resize', this.onResize);
    const lost = this.engine.onContextLostObservable.add(() => {
      this.pause('context-lost');
      this.emit({ type: 'notice', message: 'Graphics context lost — waiting for the browser to restore it…' });
    });
    const restored = this.engine.onContextRestoredObservable.add(() => {
      this.emit({ type: 'notice', message: 'Graphics restored. Click to resume.' });
    });
    this.ctxObservers.push({ remove: () => this.engine.onContextLostObservable.remove(lost) }, { remove: () => this.engine.onContextRestoredObservable.remove(restored) });

    this.resize();
    this.lastFrame = performance.now();
    this.engine.runRenderLoop(this.frameFn);
    mark('renderLoop');
    // warm-up render (compiles shaders, renders the static shadow map once)
    await scene.whenReadyAsync();
    if (this.disposed) return;
    mark('whenReady');
    this.setStatus('ready');
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                          */
  /* ------------------------------------------------------------------ */

  on(fn: (e: EngineEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: EngineEvent) {
    for (const l of this.listeners) l(e);
  }

  private setStatus(status: EngineStatus, pause?: PauseInfo) {
    this.status = status;
    this.emit({ type: 'status', status, pause });
  }

  /** Why the last start() call did not begin play ('cooldown' = re-lock too soon after Esc, 'blocked' = browser refused). */
  startIssue: 'cooldown' | 'blocked' | null = null;

  /**
   * Begin or resume play. Must be called from a click handler (pointer lock + audio need a gesture).
   *
   * Order matters: pointer lock is requested FIRST, fullscreen only after the lock is granted.
   * Fullscreen consumes the click's transient user activation while pointer lock doesn't, so the
   * reverse order makes the lock request fail with NotAllowedError.
   *
   * `freeMouse` skips pointer lock and aims with the plain (visible) cursor — the user's explicit
   * choice when the browser keeps refusing capture. Inside an embedded frame where capture is not
   * permitted, free-mouse aiming is used automatically.
   */
  async start(opts: { freeMouse?: boolean } = {}): Promise<boolean> {
    if (this.ended || this.disposed) return false;
    this.audio.init();
    this.audio.resume();
    this.input.rawRequested = this.settings.sensitivity.rawInput;
    this.startIssue = null;
    const embedded = isEmbedded();
    const locked = opts.freeMouse ? false : await this.input.requestLock();
    if (locked) {
      this.input.unlockedLook = false;
      if (this.settings.graphics.fullscreen) this.enterFullscreen();
      this.emit({ type: 'notice', message: null });
    } else {
      const cooldown = performance.now() - this.input.lastUnlock < 2500;
      if (!opts.freeMouse && (cooldown || !embedded)) {
        // Top-level tab: never silently degrade aiming — stay paused and ask for another click.
        this.startIssue = cooldown ? 'cooldown' : 'blocked';
        return false;
      }
      this.input.unlockedLook = true;
      this.emit({
        type: 'notice',
        message: embedded
          ? 'Mouse capture is not allowed inside this embedded page — aiming uses the free cursor. Open the app in its own tab for proper aiming. Press Esc to pause.'
          : 'Playing without mouse capture — aiming uses the free cursor. Press Esc to pause, then "Click to resume" to try capture again.',
      });
    }
    this.input.enabled = true;
    this.input.releaseAll();
    this.lastFrame = performance.now();
    this.setStatus('running');
    return true;
  }

  private updateHitboxView() {
    const meshes = this.hitboxMeshes!;
    this.director.bots.forEach((b, i) => {
      const boxes = humanoidHitboxes(b.crouch, BOT_SCALE);
      (['legs', 'body', 'head'] as HitZone[]).forEach((zone, k) => {
        const m = meshes[i * 3 + k];
        if (!m) return;
        const bx = boxes[zone];
        m.setEnabled(b.alive);
        m.scaling.set(bx.hx * 2, bx.hy * 2, bx.hz * 2);
        m.rotation.y = b.yaw;
        const c = Math.cos(b.yaw);
        const sn = Math.sin(b.yaw);
        m.position.set(b.x + bx.cx * c + bx.cz * sn, b.y + bx.cy, b.z - bx.cx * sn + bx.cz * c);
      });
    });
  }

  /** Fullscreen (+ Keyboard Lock). Only called once the pointer is locked — see start(). */
  private enterFullscreen() {
    void enterGameFullscreen();
  }

  pause(reason: PauseInfo['reason']) {
    if (this.status !== 'running') return;
    this.input.enabled = false;
    this.input.releaseAll();
    this.input.exitLock();
    this.setStatus('paused', { reason });
  }

  /** The weapons currently in the two slots. */
  get loadout(): { primary: WeaponId; secondary: WeaponId } {
    return { primary: this.weapons.slots[0].cfg.id, secondary: this.weapons.slots[1].cfg.id };
  }

  /**
   * Swap the weapon in a slot mid-session (weapon menu). Loads the gun's skin first when skins are
   * on and it hasn't been used yet this session; falls back to the simple model if that fails.
   */
  async setWeapon(slot: 0 | 1, id: WeaponId): Promise<void> {
    if (this.disposed || this.ended || this.status === 'loading') return;
    if (WEAPONS[id].slot !== (slot === 0 ? 'primary' : 'secondary') || this.weapons.slots[slot].cfg.id === id) return;
    if (__LOCAL_MODELS__ && this.settings.graphics.gunModels === 'skins' && !this.weaponSkins.has(id)) {
      try {
        const m = await import('../weapons/WeaponSkins');
        const skin = (await m.loadWeaponSkins(this.scene, [id])).get(id);
        if (this.disposed) {
          skin?.dispose();
          return;
        }
        if (skin) this.weaponSkins.set(id, skin);
      } catch (err) {
        console.warn(`[weapons] ${id} skin unavailable — using the simple model`, err);
      }
    }
    this.viewModel.addWeapon(id, this.weaponSkins.get(id));
    this.weapons.setSlot(slot, id);
    if (slot === 0) this.config.primary = id;
    else this.config.secondary = id;
    this.lastHud = null;
    this.emitHud();
  }

  /** End the session and return the final statistics. */
  end(): SessionStats {
    if (!this.ended) {
      this.ended = true;
      this.input.enabled = false;
      this.input.exitLock();
      const lastSpray = this.spray?.finish();
      if (lastSpray) this.tracker.spray(lastSpray);
      const stats = this.tracker.finish(this.elapsed);
      this.setStatus('ended');
      this.emit({ type: 'ended', stats });
      return stats;
    }
    return this.tracker.finish(this.elapsed);
  }

  updateSettings(s: GameSettings) {
    const prev = this.settings;
    this.settings = s;
    if (this.status === 'loading' || this.disposed) return; // init reads this.settings as it builds
    this.audio.applySettings(s.audio);
    this.input.rawRequested = s.sensitivity.rawInput;
    if (prev.graphics.resolutionScale !== s.graphics.resolutionScale || prev.graphics.adaptiveResolution !== s.graphics.adaptiveResolution) {
      if (!s.graphics.adaptiveResolution) this.dynScale = 1;
      this.applyResolution();
    }
    if (prev.graphics.fpsCap !== s.graphics.fpsCap) this.applyFpsCap();
    if (prev.graphics.antialias !== s.graphics.antialias) this.applyAntialias();
  }

  get rendererLabel() {
    return this.rendererName;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('resize', this.onResize);
    this.engine?.stopRenderLoop(this.frameFn);
    for (const o of this.ctxObservers) o.remove();
    if (this.net) this.net.onMessage = null;
    for (const r of this.remotes.values()) r.visual.dispose();
    this.remotes.clear();
    this.input?.dispose();
    this.director?.dispose();
    this.viewModel?.dispose();
    this.effects?.dispose();
    for (const a of this.agentReady.values()) a.dispose();
    this.agentReady.clear();
    for (const k of this.weaponSkins.values()) k.dispose();
    this.armsTemplate?.dispose();
    this.botAssets?.dispose();
    this.mapRender?.dispose();
    this.audio?.dispose();
    this.scene?.dispose();
    // The engine itself stays alive (shared across sessions); just hand it back.
    releaseRenderHost(this);
    this.listeners.clear();
  }

  /* ------------------------------------------------------------------ */
  /* Rendering setup helpers                                             */
  /* ------------------------------------------------------------------ */

  private applyResolution() {
    const g = this.settings.graphics;
    // Low-end tiers never render above one canvas pixel per CSS pixel.
    const dprCap = g.preset === 'high' ? 2 : g.preset === 'potato' || g.textureQuality === 'low' ? 1 : 1.5;
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    const scale = Math.max(0.35, Math.max(0.4, Math.min(1, g.resolutionScale)) * this.dynScale * dpr);
    this.engine.setHardwareScalingLevel(1 / scale);
  }

  private applyFpsCap() {
    const cap = this.settings.graphics.fpsCap;
    this.engine.maxFPS = cap > 0 ? cap : undefined;
  }

  /**
   * Adaptive resolution. Every half second of play, compare the measured frame rate with the target
   * (60, or the FPS cap if lower): drop the render scale a step when it's short, and try a step back
   * up after a quiet spell. If stepping up caused a drop, wait twice as long before trying again, so
   * a machine that can't hold the higher scale doesn't flip back and forth.
   */
  private adaptResolution(rawDt: number) {
    const g = this.settings.graphics;
    this.adaptT += rawDt;
    this.adaptFrames++;
    if (this.adaptT < 0.5) return;
    const fps = this.adaptFrames / this.adaptT;
    const span = this.adaptT;
    this.adaptT = 0;
    this.adaptFrames = 0;
    const target = g.fpsCap > 0 ? Math.min(60, g.fpsCap) : 60;

    // Still slow at the floor: tell the player once that a lower preset would help.
    const atFloor = !g.adaptiveResolution || this.dynScale <= 0.5;
    this.slowTime = fps < Math.min(40, target * 0.7) && atFloor ? this.slowTime + span : 0;
    if (this.slowTime > 6 && !this.slowWarned && g.preset !== 'potato') {
      this.slowWarned = true;
      this.emit({ type: 'notice', message: 'Low frame rate — try a lower graphics preset (Settings → Graphics → Potato or Low).' });
    }

    if (!g.adaptiveResolution) return;
    const wall = performance.now() / 1000;
    if (fps < target * 0.85) {
      if (this.dynScale > 0.5) {
        // a drop soon after stepping up means that step was too much: back off for longer
        this.adaptBackoff = wall - this.adaptLastUp < 3 ? Math.min(60, this.adaptBackoff * 2) : this.adaptBackoff;
        this.dynScale = Math.max(0.5, this.dynScale - (fps < target * 0.6 ? 0.2 : 0.1));
        this.applyResolution();
      }
      this.adaptHold = 0;
    } else if (this.dynScale < 1 && fps > target * 0.95) {
      this.adaptHold += span;
      if (this.adaptHold >= this.adaptBackoff) {
        this.adaptHold = 0;
        this.adaptLastUp = wall;
        this.dynScale = Math.min(1, this.dynScale + 0.1);
        this.applyResolution();
      }
    } else this.adaptHold = 0;
  }

  private applyAntialias() {
    if (!this.camera) return;
    if (this.settings.graphics.antialias && !this.fxaa) this.fxaa = new FxaaPostProcess('fxaa', 1, this.camera);
    else if (!this.settings.graphics.antialias && this.fxaa) {
      this.fxaa.dispose(this.camera);
      this.fxaa = null;
    }
  }

  private resize() {
    this.engine?.resize();
    const dpr = window.devicePixelRatio || 1;
    const r = this.overlay.getBoundingClientRect();
    this.overlay.width = Math.max(1, Math.round(r.width * dpr));
    this.overlay.height = Math.max(1, Math.round(r.height * dpr));
  }

  /* ------------------------------------------------------------------ */
  /* Main loop                                                           */
  /* ------------------------------------------------------------------ */

  private frame() {
    const now = performance.now();
    let dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    if (dt > 0.1) dt = 0.1;
    if (dt <= 0) dt = 1 / 240;
    this.frameMs = this.frameMs * 0.9 + dt * 1000 * 0.1;
    this.fps = 1000 / this.frameMs;
    if (this.status === 'running' && this.input.consume('loadout')) this.pause('loadout');
    const running = this.status === 'running';
    if (running) this.adaptResolution(dt);
    dt *= this.debugTimeScale; // tests can slow or freeze game time (rendering continues)

    let mdx = 0;
    let mdy = 0;
    if (running) {
      // Apply look first for minimum input latency.
      [mdx, mdy] = this.input.takeMouse();
      if (this.player.alive)
        this.player.applyLook(mdx, mdy, this.settings.sensitivity, this.weapons.isAds, !!this.weapons.weapon.ads.scope, this.weapons.zoom);
    }
    // A multiplayer match goes on whatever this player is doing: paused or not yet started, their body
    // still stands in the world and the others still move.
    if (running || (this.net && (this.status === 'paused' || this.status === 'ready'))) {
      const steps = Math.ceil(dt / SIM_STEP);
      const sdt = steps > 0 ? dt / steps : 0;
      for (let i = 0; i < steps; i++) this.simulate(sdt);
      this.elapsed += dt;
      if (this.config.durationSec > 0 && this.elapsed >= this.config.durationSec) this.end();
      if (this.net) this.updateNet(dt);
    }

    this.updateCamera();
    // a scoped weapon's own model is hidden once the scope is up (the overlay replaces it)
    this.viewModel.visible = this.player.alive && !this.scoped;
    this.viewModel.update(dt, this.weapons, this.player.speed, this.player.grounded, mdx, mdy);
    this.effects.update(dt);
    if (this.muzzleLight) this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt * 40);
    const [ex, ey, ez] = this.player.eye();
    this.audio.setListener(ex, ey, ez, this.player.yaw, this.player.pitch);

    if (this.hitboxMeshes) this.updateHitboxView();
    this.scene.render();
    const dc = (this.engine as unknown as { _drawCalls?: { current: number } })._drawCalls?.current ?? 0;
    this.drawCallsFrame = dc >= this.drawCallsTotal ? dc - this.drawCallsTotal : dc;
    this.drawCallsTotal = dc;
    this.drawOverlay(dt);

    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 1 / 12;
      this.emitHud();
    }
  }

  private simulate(dt: number) {
    this.time += dt;
    this.ctx.time = this.time;
    if (this.net) {
      // the step becomes a command: applied here now (prediction) and sent to the server, which runs the same code
      const { held, pressed } = captureMasks(this.input);
      this.input.consume('jump');
      this.netOutbox.push(this.prediction.step(this.player, dt, held & MOVE_MASK, pressed & JUMP_MASK));
    } else this.player.update(dt, this.input);
    this.weapons.update(dt, this.input, this.player);
    if (this.net && this.weapons.weapon.id !== this.netHeld) {
      // tell the others which gun is out, so they see the right one
      this.netHeld = this.weapons.weapon.id;
      this.net.send({ t: 'weapon', weapon: this.netHeld });
    }
    this.reloadSounds();
    this.boltSounds();
    this.director.useHeld = this.input.isDown('use');
    this.director.update(this.ctx, dt, (x, y, z, yaw) => this.respawnPlayer(x, y, z, yaw));
    this.updateSpike(dt);
    const sprayDone = this.spray?.update(this.time);
    if (sprayDone) this.tracker.spray(sprayDone);
    this.visTimer -= dt;
    if (this.visTimer <= 0) {
      this.visTimer = 1 / 30;
      this.trackVisibility();
    }
  }

  private reloadSounds() {
    if (!this.weapons.reloading) {
      // a reload cut short (weapon switch, death) silences its recording instead of letting it run on
      if (this.reloadClip && this.lastReloadProgress < 0.95) this.audio.stopReload();
      this.reloadClip = false;
      return;
    }
    this.lastReloadProgress = this.weapons.reloadProgress;
    // cues follow the animation: seconds into the reload at which the magazine comes out, goes in, and the bolt moves
    const cues = this.viewModel.reloadCueTimes(this.weapons);
    const t = this.weapons.reloadProgress * this.weapons.weapon.reloadTime;
    const c = this.reloadCues;
    // a recorded full reload (public/sounds) replaces the three synthesized cues
    const recorded = [`reload-${this.weapons.weapon.id}`, 'reload'].find((n) => this.audio.isRecorded(n));
    if (recorded) {
      if (!c.out) {
        c.out = c.in = c.bolt = true;
        this.reloadClip = true;
        this.audio.playReload(recorded, cues.out - t, cues.in - t);
      }
      return;
    }
    if (!c.out && t >= cues.out) {
      c.out = true;
      this.audio.play('mag-out', { volume: 0.6 });
    }
    if (!c.in && t >= cues.in) {
      c.in = true;
      this.audio.play('mag-in', { volume: 0.7 });
    }
    if (!c.bolt && cues.bolt !== null && t >= cues.bolt) {
      c.bolt = true;
      this.audio.play('bolt', { volume: 0.6 });
    }
  }

  /** Bolt action: the bolt is heard opening and closing as it is worked after a shot. */
  private boltSounds() {
    const age = this.weapons.boltCycleAge;
    if (age >= 0) {
      const k = 1 / (this.weapons.weapon.fireRate * BOLT_CYCLE.per);
      const open = BOLT_CYCLE.lift * k;
      const close = (BOLT_CYCLE.forward + 0.1) * k;
      if (this.boltAge < open && age >= open) this.audio.play('bolt', { volume: 0.55, rate: 0.9 });
      if (this.boltAge < close && age >= close) this.audio.play('bolt', { volume: 0.65, rate: 1.1 });
    }
    this.boltAge = age;
  }

  /* ------------------------------------------------------------------ */
  /* Multiplayer                                                         */
  /* ------------------------------------------------------------------ */

  /** Count a kill towards the streak and play its sound (1–5; 5 repeats after the fifth). */
  private playKillSound(weaponId: WeaponId, headshot: boolean) {
    this.killStreak++;
    if (!this.audio.hitSounds) return;
    // a weapon's own set wins if recorded
    const n = Math.min(5, this.killStreak);
    const own = `${weaponId}-kill${n}`;
    const killSound = this.audio.isRecorded(own) ? own : `kill${n}`;
    // A recorded kill sound already carries its own cue, so the synthesized headshot ping would
    // clash with it; keep the ping only when it's recorded too or the kill sound is synthesized.
    if (headshot && (!this.audio.isRecorded(killSound) || this.audio.isRecorded('headshot'))) this.audio.play('headshot', { volume: 0.7 });
    // one kill sound at a time: a quick second kill cuts the first instead of stacking on it
    this.audio.play(killSound, { volume: 0.55, delay: 0.03, group: 'kill' });
  }

  /**
   * A shot in a multiplayer match. Everything the shooter sees and hears happens now, against the
   * world as it is drawn here; whether it hurt anyone is the server's decision, which arrives as a
   * 'hit' event (docs/multiplayer.md, section 6.4).
   */
  private resolveNetShot(shot: ShotInfo) {
    const { origin: o, dir: d, weapon } = shot;
    const viewTime = this.serverClock.time(performance.now()) - INTERP_DELAY_MS;
    const wall = this.map.world.raycast(o[0], o[1], o[2], d[0], d[1], d[2], 250, COL_BULLET);
    let reach = wall ? wall.t : 250;
    let flesh: HitZone | null = null;
    for (const r of this.remotes.values()) {
      const s = r.track.at(viewTime);
      if (!s || !s.alive) continue;
      const h = rayHumanoid(o[0], o[1], o[2], d[0], d[1], d[2], s.x, s.y, s.z, s.yaw, s.crouch, reach);
      if (h) {
        reach = h.t;
        flesh = h.zone;
      }
    }
    const end: Vec3 = [o[0] + d[0] * reach, o[1] + d[1] * reach, o[2] + d[2] * reach];
    if (flesh) this.effects.fleshImpact(end[0], end[1], end[2], flesh === 'head');
    else if (wall) {
      this.effects.wallImpact(wall.x, wall.y, wall.z, wall.nx, wall.ny, wall.nz, wall.box.surface);
      const kind = surfaceKind(wall.box.surface);
      this.audio.play('impact', { pos: end, volume: kind === 'metal' ? 0.45 : 0.35, rate: (kind === 'metal' ? 1.7 : kind === 'wood' ? 0.7 : 1) * (0.94 + Math.random() * 0.12) });
    }
    if (weapon.tracer) this.effects.tracer(this.viewModel.muzzleWorld(), end);

    // the commands go first, so the server has the view this bullet left along
    this.sendCommands();
    const seq = this.prediction.lastSeq;
    this.netShots.set(seq, shot);
    if (this.netShots.size > 64) this.netShots.delete(this.netShots.keys().next().value!);
    this.net!.send({ t: 'shot', shot: { seq, weapon: weapon.id, origin: o, dir: d, viewTime } });
  }

  private onNetEvent(ev: MatchEvent) {
    const net = this.net!;
    const p = this.player;
    switch (ev.type) {
      case 'hit': {
        // the server confirms one of our bullets
        const shot = this.netShots.get(ev.seq);
        if (shot) this.tracker.hit(shot, ev.zone, ev.damage);
        if (ev.killed) {
          this.weapons.refillReserve(); // a kill restocks the spare ammunition
          this.lastHud = null;
          this.tracker.kill(shot?.weapon.id ?? this.weapons.weapon.id, ev.zone === 'head', null);
          this.hitmarker = { t: 0.35, kind: 'kill' };
          this.playKillSound(shot?.weapon.id ?? this.weapons.weapon.id, ev.zone === 'head');
        } else {
          this.hitmarker = { t: 0.2, kind: ev.zone === 'head' ? 'head' : 'body' };
          if (this.audio.hitSounds) this.audio.play(ev.zone === 'head' ? 'headshot' : 'hit', { volume: ev.zone === 'head' ? 0.55 : 0.5 });
        }
        this.remotes.get(ev.victim)?.visual.hit();
        return;
      }
      case 'damage':
        this.tracker.damageTaken(ev.damage);
        this.audio.play('hurt', { volume: 0.6 });
        this.damageIndicators.push({ yaw: Math.atan2(ev.from[0] - p.pos.x, ev.from[2] - p.pos.z), t: 1.2 });
        return;
      case 'shot': {
        // someone else fired: their gun flashes and is heard from where they stand
        const r = this.remotes.get(ev.by);
        const weapon = WEAPONS[ev.weapon];
        r?.visual.muzzleFlash();
        // gunfire gives a position away: the shooter shows on the minimap for a moment (a suppressed gun doesn't)
        if (r && !weapon.suppressed) r.revealed = FIRE_REVEAL_SEC;
        const muzzle = r ? r.visual.muzzleWorld() : ev.origin;
        this.audio.play(weapon.sound, { pos: muzzle, clean: true, bus: 'weapons', volume: weapon.suppressed ? 0.65 : 0.8, rate: 0.97 + Math.random() * 0.06 });
        if (weapon.tracer) this.effects.tracer(muzzle, ev.end, 260);
        return;
      }
      case 'kill': {
        const mine = ev.killer === net.playerId;
        const me = ev.victim === net.playerId;
        const weapon = WEAPONS[ev.weapon].name;
        this.emit({
          type: 'killfeed',
          entry: {
            id: this.killFeedId++,
            victim: me ? 'You' : net.nameOf(ev.victim),
            weapon: mine ? weapon : `${net.nameOf(ev.killer)} · ${weapon}`,
            headshot: ev.headshot,
            byPlayer: mine,
            time: Date.now(),
          },
        });
        if (me) {
          p.alive = false;
          p.health = 0;
          this.tracker.death();
          this.killStreak = 0;
          this.deathFlash = 1;
        } else {
          const victim = this.remotes.get(ev.victim);
          if (victim) {
            victim.dead = true;
            victim.visual.die();
          }
        }
        return;
      }
      case 'respawn': {
        if (ev.id === net.playerId) {
          // the commands in flight were made at the old place: they no longer mean anything
          this.respawnPlayer(ev.pos[0], ev.pos[1], ev.pos[2], ev.yaw);
          this.prediction.reset();
          this.netOffset = [0, 0, 0];
          this.netHeld = null; // the server starts a fresh body: say again which gun is out
          return;
        }
        const r = this.remotes.get(ev.id);
        r?.track.clear();
        if (r) r.dead = false;
        r?.visual.revive();
        return;
      }
      case 'loadout': {
        const { primary, secondary } = ev.loadout;
        void (async () => {
          await this.setWeapon(0, primary);
          await this.setWeapon(1, secondary);
          if (!this.disposed) this.emit({ type: 'loadout', loadout: this.loadout });
        })();
        return;
      }
    }
  }

  private onNetMessage(msg: ServerMessage) {
    if (this.disposed) return;
    if (msg.t === 'event') {
      this.onNetEvent(msg.event);
      return;
    }
    if (msg.t !== 'snapshot') return;
    this.netSnapshots++;
    this.serverClock.observe(msg.time, performance.now());
    if (msg.self) {
      const moved = this.prediction.reconcile(this.player, msg.self);
      if (moved) {
        // keep the camera where it was and ease it over to the corrected position; a teleport just cuts
        if (Math.hypot(moved[0], moved[1], moved[2]) > SNAP_DISTANCE) this.netOffset = [0, 0, 0];
        else for (let i = 0; i < 3; i++) this.netOffset[i] += moved[i];
      }
      // health and life are the server's to say
      this.player.health = msg.self.health;
      this.player.armor = msg.self.armor;
      this.player.alive = (msg.self.flags & PF_ALIVE) !== 0;
    }
    for (const p of msg.players) {
      let r = this.remotes.get(p.id);
      const agent = this.net!.agentOf(p.id);
      if (!r) {
        const n = ++this.remoteSerial;
        r = { track: new RemoteTrack(), visual: this.agentVisual(agent, 1000 + n), stepTimer: 0, voice: 0.93 + ((n * 37) % 10) * 0.012, revealed: 0, weapon: 'vandal', agent, n, model: false, dead: false };
        this.remotes.set(p.id, r);
        this.dressRemote(r, p.weapon);
      } else if (agent && agent !== r.agent) {
        // the scoreboard naming their agent can arrive after their first snapshot: dress them again
        r.agent = agent;
        this.dressRemote(r, p.weapon, true);
      }
      r.track.push(msg.time, p);
      if (p.weapon !== r.weapon) this.showRemoteWeapon(r, p.weapon);
    }
    // a player missing from the snapshot has left or dropped
    for (const [id, r] of this.remotes) {
      if (r.track.newest < msg.time) {
        r.visual.dispose();
        this.remotes.delete(id);
      }
    }
  }

  /** The footsteps heard in the last moments, aged for the minimap; older ones are dropped. */
  private heardStepMarks() {
    const now = performance.now();
    this.heardSteps = this.heardSteps.filter((h) => now - h.at < STEP_MARK_SEC * 1000);
    return this.heardSteps.map((h) => ({ x: h.x, z: h.z, age: (now - h.at) / (STEP_MARK_SEC * 1000) }));
  }

  /**
   * A running enemy takes a step at (x, y, z). If it is within earshot (less far through a wall) it is played
   * from where it happened, and the spot is marked on the minimap for a moment: what you can hear, you can
   * place. Steps out of earshot make no sound at all, so distant enemies don't add up to a background mush.
   */
  private enemyStep(x: number, y: number, z: number, voice: number, group: string) {
    const eye = this.player.eye();
    const occluded = !this.map.world.segmentClear(x, y + 1.5, z, eye[0], eye[1], eye[2]);
    const range = occluded ? STEP_HEAR_RANGE_WALLED : STEP_HEAR_RANGE;
    if (Math.hypot(x - eye[0], y - eye[1], z - eye[2]) >= range) return;
    this.audio.play(stepSound(this.surfaceUnder(x, y, z)), {
      pos: [x, y + 0.1, z],
      bus: 'foot',
      volume: 0.8,
      occluded,
      rate: voice * (0.98 + Math.random() * 0.04),
      hearRange: range,
      group,
    });
    this.heardSteps.push({ x, z, at: performance.now() });
  }

  /** Multiplayer: the other players the minimap may show, which is those who fired an unsuppressed gun a moment ago. */
  private minimapRemotes() {
    const t = this.serverClock.time(performance.now()) - INTERP_DELAY_MS;
    const out: { x: number; z: number; alive: boolean; visible: boolean }[] = [];
    for (const r of this.remotes.values()) {
      if (r.revealed <= 0) continue;
      const s = r.track.at(t);
      if (s?.alive) out.push({ x: s.x, z: s.z, alive: true, visible: false });
    }
    return out;
  }

  /** Load an agent's model once per session (null: models are off, or it failed and the blocky body stands in). */
  private loadAgent(agent: AgentId): Promise<AgentAssets | null> {
    let load = this.agentModels.get(agent);
    if (load) return load;
    if (!__LOCAL_MODELS__ || this.settings.graphics.botModel !== 'agent') load = Promise.resolve(null);
    else {
      load = import('../bots/AgentVisual')
        .then((m) => m.AgentAssets.load(this.scene, getAgent(agent).model, this.botAssets))
        .then((assets) => {
          if (this.disposed) {
            assets.dispose();
            return null;
          }
          assets.rifle = this.weaponSkins.get('vandal') ?? null;
          this.agentReady.set(agent, assets);
          return assets;
        })
        .catch((err) => {
          console.warn(`[agents] ${agent} model unavailable — using the blocky body`, err);
          return null;
        });
    }
    this.agentModels.set(agent, load);
    return load;
  }

  /** A body for an agent: their model when it has loaded, else the blocky body in their colours. */
  private agentVisual(agent: string | null, id: number): BotView {
    const ready = agent ? this.agentReady.get(agent as AgentId) : undefined;
    return ready ? ready.create(id) : new BotVisual(this.botAssets, id, getAgent(agent));
  }

  /**
   * Dress another player as their agent: the model if it is loaded, else the stand-in until it is.
   * `rebuild` replaces the body even when it is already a model (they picked another agent).
   */
  private dressRemote(r: RemotePlayer, weapon: WeaponId, rebuild = false) {
    const agent = r.agent as AgentId | null;
    const swap = () => {
      r.visual.dispose();
      r.visual = this.agentVisual(agent, 1000 + r.n);
      r.model = !!(agent && this.agentReady.has(agent));
    };
    if (rebuild) swap();
    else r.model = !!(agent && this.agentReady.has(agent));
    this.showRemoteWeapon(r, weapon);
    if (!agent || r.model) return;
    void this.loadAgent(agent).then((assets) => {
      // still here, still that agent, and not already swapped by another load
      if (!assets || this.disposed || r.agent !== agent || r.model || ![...this.remotes.values()].includes(r)) return;
      swap();
      if (r.dead) r.visual.die();
      this.showRemoteWeapon(r, r.weapon);
    });
  }

  /** Put the gun another player really carries into their model's hands, fetching its model if need be. */
  private showRemoteWeapon(r: RemotePlayer, weapon: WeaponId) {
    r.weapon = weapon;
    // they may have switched again, been rebuilt as another agent, or left, while the gun's model loaded
    this.holdWeapon(() => (r.weapon === weapon && [...this.remotes.values()].includes(r) ? r.visual : null), weapon);
  }

  /**
   * Put a gun's model into a body's hands, fetching the model if need be. `body` is asked again once
   * the model has loaded and answers null when the gun is no longer wanted there.
   */
  private holdWeapon(body: () => BotView | null, weapon: WeaponId) {
    if (!__LOCAL_MODELS__ || this.settings.graphics.gunModels !== 'skins') return;
    const ready = this.weaponSkins.get(weapon);
    if (ready) {
      body()?.setWeapon?.(ready);
      return;
    }
    let load = this.skinLoads.get(weapon);
    if (!load) {
      load = import('../weapons/WeaponSkins')
        .then((m) => m.loadWeaponSkins(this.scene, [weapon]))
        .then((skins) => {
          const skin = skins.get(weapon);
          if (this.disposed) skin?.dispose();
          else if (skin) this.weaponSkins.set(weapon, skin);
          return this.disposed ? undefined : skin;
        })
        .catch(() => undefined);
      this.skinLoads.set(weapon, load);
    }
    void load.then((skin) => {
      if (skin && !this.disposed) body()?.setWeapon?.(skin);
    });
  }

  private sendCommands() {
    if (this.netOutbox.length === 0) return;
    this.netSendTimer = 1 / INPUT_RATE;
    this.net!.send({ t: 'input', cmds: this.netOutbox });
    this.netOutbox = [];
  }

  /** Once per frame: send the commands gathered since the last packet and move the other players. */
  private updateNet(dt: number) {
    this.netSendTimer -= dt;
    if (this.netSendTimer <= 0) this.sendCommands();
    const ease = Math.exp(-dt * 12);
    for (let i = 0; i < 3; i++) this.netOffset[i] = Math.abs(this.netOffset[i]) < 1e-4 ? 0 : this.netOffset[i] * ease;

    // other players are drawn a moment in the past, between two snapshots
    const t = this.serverClock.time(performance.now()) - INTERP_DELAY_MS;
    for (const r of this.remotes.values()) {
      const s = r.track.at(t);
      if (!s) continue;
      r.revealed = s.alive ? Math.max(0, r.revealed - dt) : 0;
      // a dead player's body stays where it fell until they respawn (the 'kill' and 'respawn' events pose it)
      r.visual.update(dt, s.x, s.y, s.z, s.yaw, s.alive ? s.pitch : 0, s.crouch, s.alive ? s.speed : 0, s.y);
      // running footsteps are audible, as a bot's are
      if (s.alive && s.grounded && !s.walking && s.speed > 3.6) {
        r.stepTimer -= dt * (s.speed / RUN_SPEED);
        if (r.stepTimer <= 0) {
          r.stepTimer = 0.36;
          this.enemyStep(s.x, s.y, s.z, r.voice, `step-remote-${r.voice}`);
        }
      } else r.stepTimer = Math.min(r.stepTimer, 0.12);
    }
  }

  private updateCamera() {
    const [x, y, z] = this.player.eye();
    this.camera.position.set(x + this.netOffset[0], y + this.netOffset[1], z + this.netOffset[2]);
    const [py, pp] = this.weapons.viewPunch();
    this.camera.rotation.y = this.player.yaw + py * DEG;
    this.camera.rotation.x = -(this.player.pitch + pp * DEG);
    this.camera.fov = 2 * Math.atan(Math.tan(BASE_HFOV / 2) / this.weapons.zoom);
    const sp = this.debugSpectate;
    const b = !sp
      ? null
      : sp.remote
        ? ([...this.remotes.values()][sp.index]?.track.at(this.serverClock.time(performance.now()) - INTERP_DELAY_MS) ?? null)
        : this.director.bots[sp.index];
    if (sp && b) {
      // debug: watch a bot from outside (animation checks)
      const a = b.yaw + sp.angle;
      this.camera.position.set(b.x + Math.sin(a) * sp.dist, b.y + 1.25, b.z + Math.cos(a) * sp.dist);
      this.camera.rotation.y = a + Math.PI + 0.24;
      this.camera.rotation.x = 0.1;
      this.camera.fov = BASE_HFOV;
    }
  }

  /** True while a scope is fully raised: the sniper's, or a telescopic sight being aimed through. */
  private get scoped() {
    const ads = this.weapons.weapon.ads;
    return (!!ads.scope || ads.optic === 'scope') && this.weapons.ads > 0.85 && this.player.alive;
  }

  /** Sniper scope: black surround, a round lens and thin cross lines. */
  private drawScope(ctx: CanvasRenderingContext2D, W: number, H: number, cx: number, cy: number, dpr: number) {
    const r = Math.min(W, H) * 0.46;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.arc(cx, cy, r, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    const g = ctx.createRadialGradient(cx, cy, r * 0.72, cx, cy, r);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.75)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.lineWidth = Math.max(1, Math.round(dpr));
    const gap = 6 * dpr;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx - gap, cy);
    ctx.moveTo(cx + gap, cy);
    ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy - gap);
    ctx.moveTo(cx, cy + gap);
    ctx.lineTo(cx, cy + r);
    ctx.stroke();
    // centre dot: red when the shot will be accurate, amber while moving or in the air
    const accurate = this.weapons.lastMovementError < 0.05;
    ctx.fillStyle = accurate ? 'rgba(255,60,60,0.95)' : 'rgba(255,200,60,0.95)';
    ctx.beginPath();
    ctx.arc(cx, cy, 1.6 * dpr, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * Retake: the planted spike. A round base on three splayed feet, a ribbed core with a glowing
   * band that blinks faster as the fuse runs down, a tapered head and an antenna.
   */
  private buildSpike(sp: Spike) {
    const scene = this.scene;
    const root = new TransformNode('spike', scene);
    root.position.set(sp.x, sp.y, sp.z);
    const metal = new StandardMaterial('spike-metal', scene);
    metal.diffuseColor = Color3.FromHexString('#2a2f37');
    metal.specularColor = new Color3(0.35, 0.35, 0.38);
    const dark = new StandardMaterial('spike-dark', scene);
    dark.diffuseColor = Color3.FromHexString('#15181d');
    dark.specularColor = new Color3(0.1, 0.1, 0.1);
    const glow = new StandardMaterial('spike-glow', scene);
    glow.diffuseColor = Color3.Black();
    glow.specularColor = Color3.Black();
    glow.emissiveColor = Color3.FromHexString('#ff3b2f');
    const add = (mesh: Mesh, mat: StandardMaterial, y: number) => {
      mesh.parent = root;
      mesh.position.y = y;
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.receiveShadows = true;
      this.shadow?.addShadowCaster(mesh);
      return mesh;
    };
    const cyl = (name: string, height: number, bottom: number, top: number, tess = 16) =>
      CreateCylinder(name, { height, diameterBottom: bottom, diameterTop: top, tessellation: tess }, scene);
    add(cyl('spike-base', 0.05, 0.46, 0.42), dark, 0.085);
    add(cyl('spike-collar', 0.07, 0.3, 0.26), metal, 0.145);
    add(cyl('spike-core', 0.34, 0.22, 0.22, 12), metal, 0.35);
    for (const y of [0.24, 0.46]) add(cyl('spike-rib', 0.03, 0.25, 0.25, 12), dark, y);
    add(cyl('spike-band', 0.09, 0.235, 0.235), glow, 0.35);
    add(cyl('spike-head', 0.13, 0.22, 0.1, 12), metal, 0.585);
    add(cyl('spike-tip', 0.05, 0.07, 0.07, 10), glow, 0.675);
    add(cyl('spike-antenna', 0.3, 0.012, 0.012, 6), dark, 0.85).position.x = 0.06;
    // three feet splayed out from the base
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4;
      const foot = add(CreateBox('spike-foot', { width: 0.07, height: 0.05, depth: 0.3 }, scene), dark, 0.035);
      foot.position.x = Math.sin(a) * 0.27;
      foot.position.z = Math.cos(a) * 0.27;
      foot.rotation.y = a;
      foot.rotation.x = 0.18;
    }
    // carry handle over the head
    for (const sx of [-0.09, 0.09]) add(CreateBox('spike-handle', { width: 0.018, height: 0.16, depth: 0.018 }, scene), dark, 0.6).position.x = sx;
    add(CreateBox('spike-grip', { width: 0.2, height: 0.02, depth: 0.03 }, scene), dark, 0.69);
    this.spikeLamp = glow;
  }

  private updateSpike(dt: number) {
    const sp = this.director.spike;
    if (!sp || !this.spikeLamp) return;
    if (sp.state !== this.spikeState) {
      this.spikeState = sp.state;
      if (sp.state === 'exploded') {
        this.deathFlash = 1;
        this.audio.play('impact', { volume: 1, rate: 0.3 });
      } else if (sp.state === 'defused') this.audio.play('equip', { volume: 0.8, rate: 0.7 });
    }
    if (sp.state === 'defused') {
      this.spikeLamp.emissiveColor.set(0.2, 0.9, 0.5);
      return;
    }
    if (sp.state === 'exploded') {
      this.spikeLamp.emissiveColor.set(1, 0.6, 0.2);
      return;
    }
    // beep and blink: once a second at first, several times a second near the end
    this.spikeBeep -= dt;
    if (this.spikeBeep <= 0) {
      this.spikeBeep = Math.max(0.14, 0.16 + (sp.fuse / SPIKE_FUSE) * 0.9);
      this.spikeBlink = 0.09;
      this.audio.play('dry', { pos: [sp.x, sp.y + 0.4, sp.z], volume: 0.9, rate: 2.4 });
    }
    this.spikeBlink -= dt;
    const on = this.spikeBlink > 0;
    this.spikeLamp.emissiveColor.set(on ? 1 : 0.25, on ? 0.3 : 0.04, on ? 0.2 : 0.03);
  }

  /** What a foot at (x, y, z) is standing on: metal containers, wooden crates, otherwise stone. */
  private surfaceUnder(x: number, y: number, z: number): StepSurface {
    const hit = this.map.world.raycast(x, y + 0.4, z, 0, -1, 0, 1.2);
    return hit ? surfaceKind(hit.box.surface) : 'stone';
  }

  private respawnPlayer(x: number, y: number, z: number, yaw: number) {
    this.player.spawn(x, y, z, yaw);
    this.weapons.refill();
    this.damageIndicators.length = 0;
  }

  /* ------------------------------------------------------------------ */
  /* Combat resolution                                                   */
  /* ------------------------------------------------------------------ */

  private resolvePlayerShot(shot: ShotInfo) {
    const { origin: o, dir: d, weapon } = shot;
    this.tracker.shot(shot);
    if (shot.firstShot && shot.moving) this.moveWarn = 0.8;
    if (this.spray) {
      const done = this.spray.onShot(shot, this.time);
      if (done) this.tracker.spray(done);
    }
    this.audio.play(weapon.sound, { bus: 'weapons', volume: weapon.suppressed ? 0.65 : 0.8, rate: 0.97 + Math.random() * 0.06 });
    this.viewModel.onShot();
    if (this.muzzleLight && !weapon.suppressed) {
      const m = this.viewModel.muzzleWorld();
      this.muzzleLight.position.set(m[0], m[1], m[2]);
      this.muzzleLight.intensity = 2.2;
    }
    if (this.net) {
      this.resolveNetShot(shot);
      return;
    }

    const wall = this.map.world.raycast(o[0], o[1], o[2], d[0], d[1], d[2], 250, COL_BULLET);
    const maxT = wall ? wall.t : 250;
    let best: { bot: Bot; t: number; zone: HitZone } | null = null;
    for (const bot of this.director.bots) {
      if (!bot.alive) continue;
      const h = rayHumanoid(o[0], o[1], o[2], d[0], d[1], d[2], bot.x, bot.y, bot.z, bot.yaw, bot.crouch, best ? best.t : maxT, BOT_SCALE);
      if (h && (!best || h.t < best.t)) best = { bot, t: h.t, zone: h.zone };
    }

    let end: Vec3;
    if (best) {
      const { bot, t, zone } = best;
      end = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
      const dmg = damageAt(weapon, t)[zone];
      this.tracker.hit(shot, zone, dmg);
      if (bot.visibleToPlayer && !bot.hitThisExposure && bot.visibleSince >= 0) {
        this.tracker.reaction((this.time - bot.visibleSince) * 1000);
      }
      bot.hitThisExposure = true;
      const exposureStart = bot.visibleSince;
      const killed = bot.damage(dmg);
      this.effects.fleshImpact(end[0], end[1], end[2], zone === 'head');
      bot.alertTo(this.player.pos.x, this.player.pos.z);
      bot.brain?.onDamaged?.(bot, this.ctx);
      if (killed) {
        const killMs = exposureStart >= 0 ? (this.time - exposureStart) * 1000 : null;
        this.tracker.kill(weapon.id, zone === 'head', killMs);
        this.hitmarker = { t: 0.35, kind: 'kill' };
        this.playKillSound(weapon.id, zone === 'head');
        this.emit({
          type: 'killfeed',
          entry: { id: this.killFeedId++, victim: bot.name, weapon: weapon.name, headshot: zone === 'head', byPlayer: true, time: Date.now() },
        });
        this.director.onBotKilled(bot, this.ctx);
      } else {
        this.hitmarker = { t: 0.2, kind: zone === 'head' ? 'head' : 'body' };
        if (this.audio.hitSounds) this.audio.play(zone === 'head' ? 'headshot' : 'hit', { volume: zone === 'head' ? 0.55 : 0.5 });
      }
    } else {
      if (wall) {
        end = [wall.x, wall.y, wall.z];
        this.effects.wallImpact(wall.x, wall.y, wall.z, wall.nx, wall.ny, wall.nz, wall.box.surface);
        // one impact sound, pitched by material: a high ring off metal, a dull knock on wood
        const kind = surfaceKind(wall.box.surface);
        this.audio.play('impact', { pos: end, volume: kind === 'metal' ? 0.45 : 0.35, rate: (kind === 'metal' ? 1.7 : kind === 'wood' ? 0.7 : 1) * (0.94 + Math.random() * 0.12) });
      } else end = [o[0] + d[0] * 250, o[1] + d[1] * 250, o[2] + d[2] * 250];
      if (this.config.mode === 'jiggle') {
        const baiting = this.director.bots.some(
          (b) => b.alive && b.visibleToPlayer && b.brain instanceof PeekBehavior && b.brain.baiting,
        );
        if (baiting) this.tracker.baited();
      }
    }
    if (weapon.tracer) {
      const m = this.viewModel.muzzleWorld();
      this.effects.tracer(m, end);
    }
    // gunfire is loud: alert roaming bots
    this.director.hear(this.ctx, this.player.pos.x, this.player.pos.z, 45);
  }

  private resolveBotShot(bot: Bot, o: Vec3, d: Vec3) {
    const world = this.map.world;
    const p = this.player;
    const eye = p.eye();
    const muzzle = bot.visual ? bot.visual.muzzleWorld() : o;
    // enemy shots use the same recording and level as the player's own gun, only placed left/right
    this.audio.play(bot.weapon.sound, {
      pos: muzzle,
      clean: true,
      bus: 'weapons',
      volume: bot.weapon.suppressed ? 0.65 : 0.8,
      rate: 0.97 + Math.random() * 0.06,
    });

    const wall = world.raycast(o[0], o[1], o[2], d[0], d[1], d[2], 200, COL_BULLET);
    const maxT = wall ? wall.t : 200;
    let end: Vec3;
    const h = p.alive ? rayHumanoid(o[0], o[1], o[2], d[0], d[1], d[2], p.pos.x, p.pos.y, p.pos.z, p.yaw, p.crouch, maxT) : null;
    if (h) {
      end = [o[0] + d[0] * h.t, o[1] + d[1] * h.t, o[2] + d[2] * h.t];
      // Headshot chance 0 means no headshot damage at all, so a stray bullet to the head counts as a body hit.
      const zone = h.zone === 'head' && (bot.tuning.headshotChance ?? 0.2) <= 0 ? 'body' : h.zone;
      const dmg = Math.round(damageAt(bot.weapon, h.t)[zone] * Math.max(0, bot.tuning.damageMult ?? 1));
      const before = p.health + p.armor;
      const killed = p.damage(dmg);
      this.tracker.damageTaken(Math.min(before, dmg));
      this.audio.play('hurt', { volume: 0.6 });
      this.damageIndicators.push({ yaw: Math.atan2(bot.x - p.pos.x, bot.z - p.pos.z), t: 1.2 });
      if (killed) {
        this.tracker.death();
        this.killStreak = 0;
        this.deathFlash = 1;
        this.emit({
          type: 'killfeed',
          entry: { id: this.killFeedId++, victim: 'You', weapon: `${bot.name} · ${bot.weapon.name}`, headshot: zone === 'head', byPlayer: false, time: Date.now() },
        });
        this.director.onPlayerDeath(this.ctx);
      }
    } else {
      if (wall) {
        end = [wall.x, wall.y, wall.z];
        this.effects.wallImpact(wall.x, wall.y, wall.z, wall.nx, wall.ny, wall.nz, wall.box.surface);
      } else end = [o[0] + d[0] * 200, o[1] + d[1] * 200, o[2] + d[2] * 200];
      // near miss whiz
      const tx = eye[0] - o[0];
      const ty = eye[1] - o[1];
      const tz = eye[2] - o[2];
      const proj = tx * d[0] + ty * d[1] + tz * d[2];
      if (proj > 0 && proj < maxT) {
        const cx = o[0] + d[0] * proj - eye[0];
        const cy = o[1] + d[1] * proj - eye[1];
        const cz = o[2] + d[2] * proj - eye[2];
        if (cx * cx + cy * cy + cz * cz < 1.5 * 1.5) this.audio.play('whiz', { pos: [eye[0] + cx, eye[1] + cy, eye[2] + cz], volume: 0.5 });
      }
    }
    this.effects.tracer(muzzle, end, 260);
  }

  /** Track when each bot becomes visible on the player's screen (for reaction-time metrics). */
  private trackVisibility() {
    const [ex, ey, ez] = this.player.eye();
    const hfov = this.camera.fov;
    const aspect = this.engine.getAspectRatio(this.camera);
    const vfov = 2 * Math.atan(Math.tan(hfov / 2) / aspect);
    for (const b of this.director.bots) {
      let visible = false;
      if (b.alive && this.player.alive) {
        const dx = b.x - ex;
        const dz = b.z - ez;
        const dy = b.y + 1.2 * BOT_SCALE - ey;
        let yawDiff = Math.atan2(dx, dz) - this.player.yaw;
        while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
        while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
        const pitchDiff = Math.atan2(dy, Math.hypot(dx, dz)) - this.player.pitch;
        if (Math.abs(yawDiff) < hfov / 2 && Math.abs(pitchDiff) < vfov / 2) {
          visible = visibleSampleCount(this.map.world, ex, ey, ez, b.x, b.y, b.z, b.crouch) > 0;
        }
      }
      if (visible && !b.visibleToPlayer) {
        b.visibleToPlayer = true;
        b.visibleSince = this.time;
        b.hitThisExposure = false;
      } else if (!visible && b.visibleToPlayer) {
        b.visibleToPlayer = false;
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Overlay (crosshair, hitmarkers, damage direction)                   */
  /* ------------------------------------------------------------------ */

  private drawOverlay(dt: number) {
    const ctx = this.overlayCtx;
    const W = this.overlay.width;
    const H = this.overlay.height;
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, W, H);
    const cx = Math.floor(W / 2);
    const cy = Math.floor(H / 2);

    if (this.scoped && this.status !== 'ended') this.drawScope(ctx, W, H, cx, cy, dpr);
    else if (this.player.alive && this.status !== 'ended' && !this.weapons.weapon.ads.scope) {
      // (a scoped weapon has no crosshair from the hip: it is aimed through the scope)
      // convert spread (degrees) to crosshair pixels
      const halfW = W / dpr / 2;
      const k = halfW / Math.tan(this.camera.fov / 2);
      const toPx = (deg: number) => Math.tan(deg * DEG) * k;
      drawCrosshair(ctx, this.settings.crosshair, cx, cy, dpr, {
        movementPx: toPx(this.weapons.lastMovementError) * 0.6,
        firingPx: toPx(this.weapons.lastFiringError) * 1.6,
      });
    }

    // retake: defuse prompt and progress bar
    const spike = this.director?.spike;
    if (spike && spike.state === 'armed' && spike.inRange && this.player.alive && this.status !== 'ended') {
      const bw = 220 * dpr;
      const bh = 8 * dpr;
      const by = cy + 70 * dpr;
      ctx.font = `700 ${Math.round(14 * dpr)}px "Barlow Condensed", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(spike.progress > 0 ? 'DEFUSING…' : 'HOLD E TO DEFUSE', cx + dpr, by - 5 * dpr);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(spike.progress > 0 ? 'DEFUSING…' : 'HOLD E TO DEFUSE', cx, by - 6 * dpr);
      ctx.fillStyle = 'rgba(10,14,20,0.7)';
      ctx.fillRect(cx - bw / 2, by, bw, bh);
      ctx.fillStyle = '#5ee0c8';
      ctx.fillRect(cx - bw / 2, by, bw * spike.progress, bh);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = dpr;
      ctx.strokeRect(cx - bw / 2, by, bw, bh);
    }

    if (this.moveWarn > 0) {
      this.moveWarn -= dt;
      if (this.settings.hud.showMoveWarning && this.status !== 'ended') {
        const a = Math.min(1, this.moveWarn / 0.3);
        ctx.font = `700 ${Math.round(13 * dpr)}px "Barlow Condensed", system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = `rgba(0,0,0,${0.5 * a})`;
        ctx.fillText('MOVING — STOP BEFORE YOU SHOOT', cx + dpr, cy + 39 * dpr);
        ctx.fillStyle = `rgba(255,190,70,${a})`;
        ctx.fillText('MOVING — STOP BEFORE YOU SHOOT', cx, cy + 38 * dpr);
      }
    }

    if (this.settings.hud.showHitmarkers && this.hitmarker.t > 0) {
      this.hitmarker.t -= dt;
      const a = Math.min(1, this.hitmarker.t / 0.15);
      const kind = this.hitmarker.kind;
      ctx.strokeStyle = kind === 'kill' ? `rgba(255,70,85,${a})` : kind === 'head' ? `rgba(255,230,120,${a})` : `rgba(255,255,255,${a})`;
      ctx.lineWidth = (kind === 'kill' ? 3 : 2) * dpr;
      const r0 = (kind === 'kill' ? 9 : 7) * dpr;
      const r1 = (kind === 'kill' ? 18 : 13) * dpr;
      ctx.beginPath();
      for (const [sx, sy] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ]) {
        ctx.moveTo(cx + sx * r0, cy + sy * r0);
        ctx.lineTo(cx + sx * r1, cy + sy * r1);
      }
      ctx.stroke();
    }

    if (this.settings.hud.showMinimap && this.status !== 'ended') {
      this.minimap.draw(
        ctx,
        dpr,
        12,
        12,
        { x: this.player.pos.x, z: this.player.pos.z, yaw: this.player.yaw, alive: this.player.alive },
        this.net ? this.minimapRemotes() : this.director.bots.map((b) => ({ x: b.x, z: b.z, alive: b.alive, visible: b.visibleToPlayer })),
        // in a match the only players listed are the ones who just fired, and they show at any distance
        {
          size: 220,
          viewRange: 26,
          enemyRange: this.net ? 1e6 : this.settings.hud.minimapEnemyRange,
          fov: this.camera.fov,
          objective: this.director.spike,
          sounds: this.heardStepMarks(),
        },
      );
    }

    if (this.spray && this.status !== 'ended') {
      const w = this.weapons.weapon;
      if (this.sprayPattern?.id !== w.id) {
        const points: [number, number][] = [];
        for (let i = 0; i < w.magazine; i++) points.push(recoilAt(w, i));
        this.sprayPattern = { id: w.id, points };
      }
      drawSprayPanel(ctx, dpr, W, H, {
        weaponName: w.name,
        pattern: this.sprayPattern.points,
        live: this.spray.livePoints,
        last: this.spray.last,
        summary: this.tracker.stats.spray,
      });
    }

    if (this.settings.hud.showDamageIndicator) {
      for (let i = this.damageIndicators.length - 1; i >= 0; i--) {
        const di = this.damageIndicators[i];
        di.t -= dt;
        if (di.t <= 0) {
          this.damageIndicators.splice(i, 1);
          continue;
        }
        const rel = di.yaw - this.player.yaw; // 0 = in front
        const a = Math.min(1, di.t / 0.6);
        const r = 110 * dpr;
        // screen angle: front = up (-PI/2)
        const ang = rel - Math.PI / 2;
        ctx.strokeStyle = `rgba(255,60,70,${0.85 * a})`;
        ctx.lineWidth = 6 * dpr;
        ctx.beginPath();
        ctx.arc(cx, cy, r, ang - 0.32, ang + 0.32);
        ctx.stroke();
      }
    }

    if (this.deathFlash > 0) this.deathFlash = Math.max(0, this.deathFlash - dt * 0.8);
  }

  /* ------------------------------------------------------------------ */
  /* HUD                                                                 */
  /* ------------------------------------------------------------------ */

  private emitHud() {
    const st = this.tracker.stats;
    const w = this.weapons.weapon;
    const hud: HudState = {
      health: Math.ceil(this.player.health),
      armor: Math.ceil(this.player.armor),
      weaponId: w.id,
      weaponName: w.name,
      ammo: this.weapons.slot.ammo,
      reserve: this.weapons.infiniteAmmo ? -1 : this.weapons.slot.reserve,
      reloading: this.weapons.reloading,
      reloadProgress: Math.round(this.weapons.reloadProgress * 20) / 20,
      ads: this.weapons.isAds,
      scopeZoom:
        this.weapons.isAds && (this.weapons.weapon.ads.scope || this.weapons.weapon.ads.optic === 'scope')
          ? this.weapons.scopeLevel === 2
            ? (this.weapons.weapon.ads.zoom2 ?? 0)
            : this.weapons.weapon.ads.zoom
          : 0,
      kills: st.kills,
      deaths: st.deaths,
      score: this.tracker.computeScore(),
      escapes: st.escapes,
      timeLeft: this.net
        ? this.netSnapshots > 0
          ? Math.max(0, Math.ceil((this.net.endsAt - this.serverClock.time(performance.now())) / 1000))
          : -1
        : this.config.durationSec > 0
          ? Math.max(0, Math.ceil(this.config.durationSec - this.elapsed))
          : -1,
      elapsed: Math.floor(this.elapsed),
      fps: Math.round(this.fps),
      frameMs: Math.round(this.frameMs * 10) / 10,
      drawCalls: this.drawCallsFrame,
      activeBots: this.director.activeBots,
      accuracy: Math.round(pct(st.hits, st.shots)),
      headshotPct: Math.round(pct(st.headshots, st.hits)),
      avgReaction: Math.round(avg(st.reactionTimes)),
      speed: Math.round(this.player.speed * 10) / 10,
      dead: !this.player.alive,
      modeLabel: this.director.statusLabel ?? MODE_LABELS[this.config.mode],
    };
    const prev = this.lastHud;
    if (prev && (Object.keys(hud) as (keyof HudState)[]).every((k) => prev[k] === hud[k])) return;
    this.lastHud = hud;
    this.emit({ type: 'hud', hud });
  }

  /* ------------------------------------------------------------------ */
  /* Debug / automation API (used by tests)                              */
  /* ------------------------------------------------------------------ */

  readonly debug = {
    state: () => ({
      status: this.status,
      renderer: this.rendererName,
      renderScale: this.dynScale,
      time: this.time,
      elapsed: this.elapsed,
      fps: Math.round(this.fps),
      drawCalls: this.drawCallsFrame,
      meshes: this.scene.getActiveMeshes().length,
      player: {
        pos: { ...this.player.pos },
        yaw: this.player.yaw,
        pitch: this.player.pitch,
        alive: this.player.alive,
        health: this.player.health,
        armor: this.player.armor,
        speed: this.player.speed,
        crouch: this.player.crouch,
      },
      weapon: { id: this.weapons.weapon.id, ammo: this.weapons.slot.ammo, reloading: this.weapons.reloading, recoilIndex: this.weapons.recoilIndex },
      bots: this.director.bots.map((b) => ({
        id: b.id,
        name: b.name,
        alive: b.alive,
        pos: [b.x, b.y, b.z],
        yaw: b.yaw,
        crouch: b.crouch,
        health: b.health + b.armor,
        brain: b.brain?.describe(),
        seesPlayer: b.seesPlayer,
        visibleToPlayer: b.visibleToPlayer,
        shots: b.shotsFired,
      })),
      stats: { ...this.tracker.stats },
      unusableSpots: this.director.unusableSpots,
    }),
    /** Start without pointer lock (automation). */
    forceRun: () => {
      this.audio.init();
      this.input.unlockedLook = true;
      this.input.enabled = true;
      this.setStatus('running');
    },
    key: (action: Parameters<Input['inject']>[0], down: boolean) => this.input.inject(action, down),
    mouse: (dx: number, dy: number) => this.input.injectMouse(dx, dy),
    setView: (yawDeg: number, pitchDeg: number) => {
      this.player.yaw = yawDeg * DEG;
      this.player.pitch = pitchDeg * DEG;
    },
    /** Point the camera at a bot's head (or chest). */
    aimAtBot: (index: number, zone: 'head' | 'body' = 'head') => {
      const b = this.director.bots.filter((x) => x.alive)[index];
      if (!b) return false;
      const [ex, ey, ez] = this.player.eye();
      const legH = 0.86 - 0.55 * b.crouch;
      const ty = b.y + (zone === 'head' ? legH + 0.75 : legH + 0.3) * BOT_SCALE;
      this.player.yaw = Math.atan2(b.x - ex, b.z - ez);
      this.player.pitch = Math.atan2(ty - ey, Math.hypot(b.x - ex, b.z - ez));
      return true;
    },
    teleport: (x: number, y: number, z: number) => {
      this.player.pos.x = x;
      this.player.pos.y = y;
      this.player.pos.z = z;
    },
    /** Show the bots' hit boxes as wireframes (model/hitbox alignment checks). */
    hitboxes: (on: boolean) => {
      if (!on) {
        for (const m of this.hitboxMeshes ?? []) m.dispose();
        this.hitboxMeshes = null;
        return;
      }
      if (this.hitboxMeshes) return;
      const mat = new StandardMaterial('hitbox-wire', this.scene);
      mat.wireframe = true;
      mat.emissiveColor = new Color3(0.2, 1, 0.4);
      mat.disableLighting = true;
      this.hitboxMeshes = [];
      for (let i = 0; i < this.director.bots.length * 3; i++) {
        const m = CreateBox('hitbox', { size: 1 }, this.scene);
        m.material = mat;
        m.isPickable = false;
        m.rotationQuaternion = null;
        this.hitboxMeshes.push(m);
      }
    },
    /** Scale game time (0 = frozen, 1 = normal) so screenshots can be taken at exact moments. */
    timeScale: (s: number) => {
      this.debugTimeScale = Math.max(0, s);
    },
    /** Watch bot `index` from `dist` metres, `angle` radians round from its front (null = back to first person). */
    spectate: (index: number | null, angle = 0.8, dist = 3.2) => {
      this.debugSpectate = index === null ? null : { index, angle, dist };
    },
    /** Multiplayer: connection and prediction figures, and where the other players are drawn. */
    net: () => {
      const t = this.serverClock.time(performance.now()) - INTERP_DELAY_MS;
      return {
        snapshots: this.netSnapshots,
        unacked: this.prediction.unacked,
        corrections: this.prediction.corrections,
        lastError: this.prediction.lastError,
        pos: [this.player.pos.x, this.player.pos.y, this.player.pos.z],
        remotes: [...this.remotes].map(([id, r]) => ({ id, ...r.track.at(t) })),
      };
    },
    /** Multiplayer: point the camera at another player's head or chest, as drawn here. False if they aren't there or alive. */
    aimAtRemote: (index: number, zone: 'head' | 'body' = 'head') => {
      const s = [...this.remotes.values()][index]?.track.at(this.serverClock.time(performance.now()) - INTERP_DELAY_MS);
      if (!s || !s.alive) return false;
      const [ex, ey, ez] = this.player.eye();
      const legH = 0.86 - 0.55 * s.crouch;
      const ty = s.y + (zone === 'head' ? legH + 0.75 : legH + 0.3);
      this.player.yaw = Math.atan2(s.x - ex, s.z - ez);
      this.player.pitch = Math.atan2(ty - ey, Math.hypot(s.x - ex, s.z - ez));
      return true;
    },
    /** Multiplayer: watch another player from outside, as `spectate` does for bots (null = back to first person). */
    spectateRemote: (index: number | null, angle = 0.8, dist = 3.2) => {
      this.debugSpectate = index === null ? null : { index, angle, dist, remote: true };
    },
    /** Multiplayer: cut the connection, as a network failure would (it reconnects by itself). */
    netDrop: () => this.net?.drop(),
    /** Multiplayer: add `ms` of round-trip delay (± jitter) to the connection, to feel a real one. */
    netLag: (ms: number, jitter = 0) => this.net?.setLag(ms, jitter),
    godMode: (on: boolean) => {
      this.ctx.botsShootBack = !on;
    },
    weapons: () => Object.keys(WEAPONS),
    audio: () => ({ ready: this.audio.ready, gunsReady: this.audio.gunsReady, overrides: this.audio.sampleOverrides }),
    /** Render every gunshot variant to base64 WAV (for listening tests / previews). */
    renderGunWavs: async (sampleRate = 48000) => {
      const guns = await renderAllGuns(sampleRate, 2);
      const out: Record<string, string[]> = {};
      for (const [id, list] of guns) {
        out[id] = list.map((b) => {
          const bytes = new Uint8Array(encodeWav(b));
          let bin = '';
          for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          return btoa(bin);
        });
      }
      return out;
    },
  };
}
