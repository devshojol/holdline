import type { BotBehavior, Difficulty, PracticeMode, SessionStats } from '../types';
import { MAP_SUMMARIES } from '../game/maps/registry';

export const MODE_INFO: Record<PracticeMode, { label: string; short: string; desc: string }> = {
  'angle-hold': {
    label: 'Hold the Angle',
    short: 'Hold',
    desc: 'Lock down a corner while enemies peek from cover. Drop them before they duck back: every escape costs points.',
  },
  jiggle: {
    label: 'Bait & Peek',
    short: 'Bait',
    desc: 'Enemies flash a shoulder to bait your shots, then swing for real. Keep your bullets for the real peek.',
  },
  'site-clear': {
    label: 'Clear the Site',
    short: 'Clear',
    desc: 'Push in and take out every defender. They hide in new spots each round and turn to your footsteps. Clears are timed.',
  },
  retake: {
    label: 'Defuse Run',
    short: 'Defuse',
    desc: 'A charge is ticking and defenders guard it. Fight through and hold E on it before the 45-second fuse runs out.',
  },
  deathmatch: {
    label: 'Deathmatch',
    short: 'Deathmatch',
    desc: 'Free-for-all against bots that roam the map, hunt you by sound and fall back when hurt.',
  },
  spray: {
    label: 'Recoil Range',
    short: 'Recoil',
    desc: 'No enemies: spray at a wall and pull against the kick. Every spray is scored on how tight you keep it.',
  },
};

export const BEHAVIOR_INFO: Record<BotBehavior, { label: string; desc: string }> = {
  mixed: { label: 'Mixed', desc: 'Varied tactics weighted by aggression.' },
  stationary: { label: 'Stationary', desc: 'Holds an exposed angle and fires on sight.' },
  jiggle: { label: 'Jiggle', desc: 'Rapid out-and-back peeks, sometimes ending in a commit.' },
  shoulder: { label: 'Shoulder', desc: 'Shows only a shoulder to bait shots.' },
  'wide-swing': { label: 'Wide Swing', desc: 'Backs up, sprints wide across your view, stops and fights.' },
  'crouch-spray': { label: 'Crouch Spray', desc: 'Peeks, crouches and sprays with recoil control.' },
  'counter-strafe': { label: 'Counter-Strafe', desc: 'ADAD strafes, stopping sharply before each burst.' },
};

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: 'Easy',
  normal: 'Normal',
  hard: 'Hard',
  radiant: 'Elite',
  custom: 'Custom',
};

export function mapName(id: string) {
  return MAP_SUMMARIES.find((m) => m.id === id)?.name ?? id;
}

export function locationName(mapId: string, locId: string) {
  return MAP_SUMMARIES.find((m) => m.id === mapId)?.locations.find((l) => l.id === locId)?.name ?? locId;
}

export function fmtDuration(sec: number) {
  if (sec <= 0) return '∞';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function fmtDate(ts: number) {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function accuracy(s: Pick<SessionStats, 'hits' | 'shots'>) {
  return s.shots ? Math.round((s.hits / s.shots) * 100) : 0;
}

export function hsPct(s: Pick<SessionStats, 'headshots' | 'hits'>) {
  return s.hits ? Math.round((s.headshots / s.hits) * 100) : 0;
}

export function avgMs(xs: number[]) {
  return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0;
}

export function dayKey(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
