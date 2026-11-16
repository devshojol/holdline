/**
 * Share a practice setup as a short text code (map, location, side, mode, bots, weapons, difficulty).
 * Codes are plain data: everything read back is checked against what this build knows.
 */
import type { PracticeConfig } from '../types';
import { MAP_SUMMARIES } from '../game/maps/registry';
import { WEAPONS } from '../game/weapons/weaponConfigs';
import { mergeDefaults } from '../services/storage';
import { DEFAULT_PRACTICE, DIFFICULTY_PRESETS } from '../settings/defaults';
import { BEHAVIOR_INFO, MODE_INFO } from './labels';

const PREFIX = 'TALS1-';

export function exportSetupCode(cfg: PracticeConfig): string {
  // a named difficulty is rebuilt from its preset on import, so its tuning needn't travel
  const { tuning, ...rest } = cfg;
  const data = cfg.difficulty === 'custom' ? cfg : rest;
  return PREFIX + btoa(unescape(encodeURIComponent(JSON.stringify(data))));
}

export function importSetupCode(code: string): PracticeConfig | null {
  try {
    const trimmed = code.trim();
    if (!trimmed.startsWith(PREFIX)) return null;
    const parsed: unknown = JSON.parse(decodeURIComponent(escape(atob(trimmed.slice(PREFIX.length)))));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const cfg = mergeDefaults(DEFAULT_PRACTICE, parsed);
    if (!MAP_SUMMARIES.some((m) => m.id === cfg.mapId)) return null;
    if (!(cfg.mode in MODE_INFO) || !(cfg.behavior in BEHAVIOR_INFO)) return null;
    if (!(cfg.primary in WEAPONS) || !(cfg.secondary in WEAPONS)) return null;
    if (cfg.side !== 'attack' && cfg.side !== 'defend') return null;
    if (cfg.difficulty !== 'custom' && !(cfg.difficulty in DIFFICULTY_PRESETS)) return null;
    if (!Array.isArray(cfg.enemySpotIds) || cfg.enemySpotIds.some((id) => typeof id !== 'string')) return null;
    const num = (v: number, lo: number, hi: number, fallback: number) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback);
    return {
      ...cfg,
      botCount: Math.round(num(cfg.botCount, 1, 10, DEFAULT_PRACTICE.botCount)),
      durationSec: Math.round(num(cfg.durationSec, 0, 3600, DEFAULT_PRACTICE.durationSec)),
      tuning: cfg.difficulty === 'custom' ? mergeDefaults(DIFFICULTY_PRESETS.normal, cfg.tuning) : DIFFICULTY_PRESETS[cfg.difficulty],
    };
  } catch {
    return null;
  }
}
