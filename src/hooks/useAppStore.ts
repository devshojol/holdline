import { useSyncExternalStore } from 'react';
import type { CrosshairPreset, GameSettings, PracticeConfig, SessionStats } from '../types';
import { DEFAULT_PRACTICE, DEFAULT_SETTINGS, DIFFICULTY_PRESETS, GRAPHICS_PRESETS } from '../settings/defaults';
import { detectDevice } from '../settings/deviceProfile';
import { load, mergeDefaults, save } from '../services/storage';
import { enterGameFullscreen } from '../utils/fullscreen';
import { readResume } from '../multiplayer/resume';
import { cleanKeys } from '../settings/keybindings';

export type Page = 'home' | 'practice' | 'multiplayer' | 'maps' | 'weapons' | 'crosshair' | 'sensitivity' | 'statistics' | 'settings';

export interface AppState {
  page: Page;
  settings: GameSettings;
  practice: PracticeConfig;
  sessions: SessionStats[];
  presets: CrosshairPreset[];
  /** Config of the running session (null = in menus). */
  playing: PracticeConfig | null;
  lastSession: SessionStats | null;
  /** The daily routine being played: its drills in order, which one is up and the scores so far. */
  routine: Routine | null;
  /** Finished routines, newest first. */
  routineHistory: RoutineResult[];
}

export interface Routine {
  steps: PracticeConfig[];
  titles: string[];
  index: number;
  scores: number[];
}

export interface RoutineResult {
  /** Local day, YYYY-MM-DD. */
  day: string;
  total: number;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const MAX_SESSIONS = 300;

/** Map values saved by older builds onto the current options. */
function migrateSettings(s: GameSettings): GameSettings {
  let fpArms: GameSettings['graphics']['fpArms'] = s.graphics.fpArms;
  if (fpArms !== 'animated' && fpArms !== 'rigged' && fpArms !== 'simple') fpArms = 'animated';
  // 'rigged' was the default before the animated arms existed: move it to the new default once
  if (fpArms === 'rigged' && !load('arms-anim-migrated', false)) fpArms = 'animated';
  save('arms-anim-migrated', true);
  const keys = cleanKeys(s.keys);
  // the Potato preset and the stand-in models are gone: soldiers, guns and hands are always the real models
  let graphics = { ...s.graphics, fpArms };
  if ((graphics.preset as string) === 'potato') graphics = { ...graphics, ...GRAPHICS_PRESETS.low, preset: 'low' };
  graphics = { ...graphics, botModel: 'agent', gunModels: 'skins', fpArms: graphics.fpArms === 'simple' ? 'animated' : graphics.fpArms };
  return { ...s, keys, graphics };
}

/** Settings on first run: the defaults with a graphics preset picked for this machine. */
function firstRunSettings(): GameSettings {
  if (typeof document === 'undefined') return DEFAULT_SETTINGS;
  const { preset } = detectDevice();
  const settings = { ...DEFAULT_SETTINGS, graphics: { ...DEFAULT_SETTINGS.graphics, ...GRAPHICS_PRESETS[preset], preset } };
  save('settings', settings);
  return settings;
}

/** A saved setup on a named difficulty always uses that difficulty's current values (presets gain fields over time). */
function loadPractice(): PracticeConfig {
  const p = mergeDefaults(DEFAULT_PRACTICE, load('practice', DEFAULT_PRACTICE));
  return p.difficulty === 'custom' ? p : { ...p, tuning: DIFFICULTY_PRESETS[p.difficulty] ?? p.tuning };
}

/** An invite link (`?room=CODE`), or a reload while in a room, opens the Multiplayer page, which takes it from there. */
function opensMultiplayer(): boolean {
  if (typeof location === 'undefined') return false;
  return new URLSearchParams(location.search).has('room') || readResume() !== undefined;
}

function initialState(): AppState {
  const stored = load<GameSettings | null>('settings', null);
  return {
    page: opensMultiplayer() ? 'multiplayer' : 'home',
    settings: stored ? migrateSettings(mergeDefaults(DEFAULT_SETTINGS, stored)) : firstRunSettings(),
    practice: loadPractice(),
    sessions: load<SessionStats[]>('sessions', []),
    presets: load<CrosshairPreset[]>('crosshair-presets', []),
    playing: null,
    lastSession: null,
    routine: null,
    routineHistory: load<RoutineResult[]>('routine-history', []),
  };
}

let state: AppState = initialState();
const listeners = new Set<() => void>();

function set(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export const store = {
  get: () => state,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  go(page: Page) {
    set({ page });
  },
  updateSettings(fn: (s: GameSettings) => GameSettings) {
    const settings = fn(state.settings);
    save('settings', settings);
    set({ settings });
  },
  updatePractice(patch: Partial<PracticeConfig>) {
    const practice = { ...state.practice, ...patch };
    save('practice', practice);
    set({ practice });
  },
  /** Launch a session. Call from a click handler: fullscreen is requested here, on the launching click,
   *  so the later "Click to start" click keeps its user activation for pointer lock. */
  play(cfg: PracticeConfig) {
    if (state.settings.graphics.fullscreen) void enterGameFullscreen();
    save('practice', cfg);
    set({ playing: cfg, practice: cfg });
  },
  stopPlaying() {
    set({ playing: null, routine: null });
  },
  /** Start the daily routine: the drills run back to back. The saved practice setup is left alone. */
  startRoutine(steps: PracticeConfig[], titles: string[]) {
    if (steps.length === 0) return;
    if (state.settings.graphics.fullscreen) void enterGameFullscreen();
    set({ routine: { steps, titles, index: 0, scores: [] }, playing: steps[0] });
  },
  /** Record the score of the routine drill that just ended (once per drill). */
  recordRoutineScore(score: number) {
    const r = state.routine;
    if (!r || r.scores.length !== r.index) return;
    set({ routine: { ...r, scores: [...r.scores, score] } });
  },
  /** Move to the next routine drill, or finish and save the total after the last one. */
  nextRoutineStep() {
    const r = state.routine;
    if (!r) return;
    if (r.index + 1 < r.steps.length) {
      if (state.settings.graphics.fullscreen) void enterGameFullscreen();
      set({ routine: { ...r, index: r.index + 1 }, playing: r.steps[r.index + 1] });
      return;
    }
    const total = r.scores.reduce((a, b) => a + b, 0);
    const routineHistory = [{ day: today(), total }, ...state.routineHistory].slice(0, 200);
    save('routine-history', routineHistory);
    set({ routineHistory, routine: null, playing: null, page: 'home' });
  },
  addSession(s: SessionStats) {
    const sessions = [s, ...state.sessions].slice(0, MAX_SESSIONS);
    save('sessions', sessions);
    set({ sessions, lastSession: s });
  },
  clearSessions() {
    save('sessions', []);
    set({ sessions: [] });
  },
  savePresets(presets: CrosshairPreset[]) {
    save('crosshair-presets', presets);
    set({ presets });
  },
};

export function useAppStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()));
}
