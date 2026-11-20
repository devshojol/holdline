import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYS, bindKey, cleanKeys, keyLabel, keysOf } from '../src/settings/keybindings';

describe('key bindings', () => {
  it('moves a key that is already used to the new action', () => {
    const { keys, movedFrom } = bindKey(DEFAULT_KEYS, 'reload', 0, 'KeyE');
    expect(keys.reload[0]).toBe('KeyE');
    expect(movedFrom).toBe('use');
    expect(keys.use).toEqual(['Digit4', '']);
  });
  it('keeps a lone key in the first slot when the first is cleared', () => {
    const { keys } = bindKey(DEFAULT_KEYS, 'use', 0, '');
    expect(keys.use).toEqual(['Digit4', '']);
  });
  it('labels keys the way players know them', () => {
    expect(keyLabel('KeyW')).toBe('W');
    expect(keyLabel('Digit1')).toBe('1');
    expect(keyLabel('Mouse0')).toBe('Left click');
    expect(keysOf(DEFAULT_KEYS, 'walk')).toBe('L Shift / R Shift');
  });
  it('falls back to the default for anything malformed in a save', () => {
    const keys = cleanKeys({ jump: ['KeyF', ''], fire: 'Mouse0', reload: [1, 2] });
    expect(keys.jump).toEqual(['KeyF', '']);
    expect(keys.fire).toEqual(DEFAULT_KEYS.fire);
    expect(keys.reload).toEqual(DEFAULT_KEYS.reload);
  });
});
