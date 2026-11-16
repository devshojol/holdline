import { describe, expect, it } from 'vitest';
import { exportSetupCode, importSetupCode } from '../src/utils/setupCode';
import { DEFAULT_PRACTICE, DIFFICULTY_PRESETS } from '../src/settings/defaults';

describe('setup codes', () => {
  it('round-trips a setup and rebuilds a named difficulty from its preset', () => {
    const cfg = { ...DEFAULT_PRACTICE, mode: 'retake' as const, side: 'defend' as const, botCount: 4, difficulty: 'hard' as const, tuning: DIFFICULTY_PRESETS.hard };
    const code = exportSetupCode(cfg);
    expect(code.startsWith('TALS1-')).toBe(true);
    expect(importSetupCode(code)).toEqual(cfg);
  });

  it('keeps custom tuning', () => {
    const cfg = { ...DEFAULT_PRACTICE, difficulty: 'custom' as const, tuning: { ...DIFFICULTY_PRESETS.normal, reactionMs: 333 } };
    expect(importSetupCode(exportSetupCode(cfg))?.tuning.reactionMs).toBe(333);
  });

  it('rejects junk, unknown maps, modes and weapons, and clamps numbers', () => {
    const enc = (o: unknown) => 'TALS1-' + btoa(JSON.stringify(o));
    expect(importSetupCode('hello')).toBeNull();
    expect(importSetupCode('TALS1-not-base64!!')).toBeNull();
    expect(importSetupCode(enc([1, 2]))).toBeNull();
    expect(importSetupCode(enc({ mapId: 'nowhere' }))).toBeNull();
    expect(importSetupCode(enc({ mode: 'cheat' }))).toBeNull();
    expect(importSetupCode(enc({ primary: 'railgun' }))).toBeNull();
    expect(importSetupCode(enc({ botCount: 999, durationSec: -5 }))).toMatchObject({ botCount: 10, durationSec: 0 });
  });
});
