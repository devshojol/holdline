/**
 * Rebindable controls: every action has two slots, each holding a key code (`KeyboardEvent.code`, so a
 * binding follows the key's position whatever the keyboard layout) or a mouse button (`Mouse0` = left,
 * `Mouse1` = middle, `Mouse2` = right, `Mouse3`/`Mouse4` = the side buttons). '' is an empty slot.
 */
import type { Action } from '../game/core/actions';

/** Game actions, plus the two map keys the page handles itself. */
export type BindAction = Exclude<Action, never> | 'mapToggle' | 'mapHold';

export type KeyBindings = Record<BindAction, [string, string]>;

export const DEFAULT_KEYS: KeyBindings = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  walk: ['ShiftLeft', 'ShiftRight'],
  crouch: ['ControlLeft', 'KeyC'],
  jump: ['Space', ''],
  fire: ['Mouse0', ''],
  alt: ['Mouse2', ''],
  reload: ['KeyR', ''],
  use: ['KeyE', 'Digit4'],
  primary: ['Digit1', ''],
  secondary: ['Digit2', ''],
  swap: ['', ''],
  loadout: ['KeyB', ''],
  mapToggle: ['KeyM', ''],
  mapHold: ['Tab', ''],
};

export interface BindGroup {
  title: string;
  rows: { action: BindAction; label: string; hint?: string; keyboardOnly?: boolean }[];
}

/** How the Controls screen lists them. */
export const BIND_GROUPS: BindGroup[] = [
  {
    title: 'Movement',
    rows: [
      { action: 'forward', label: 'Move forward' },
      { action: 'back', label: 'Move back' },
      { action: 'left', label: 'Strafe left' },
      { action: 'right', label: 'Strafe right' },
      { action: 'walk', label: 'Walk', hint: 'Hold: silent and more accurate' },
      { action: 'crouch', label: 'Crouch', hint: 'Hold. Outside fullscreen, Ctrl + W closes the tab: use C there' },
      { action: 'jump', label: 'Jump' },
    ],
  },
  {
    title: 'Combat',
    rows: [
      { action: 'fire', label: 'Fire' },
      { action: 'alt', label: 'Aim down sights', hint: 'Scope on the Monarch, burst on the Pilot' },
      { action: 'reload', label: 'Reload' },
      { action: 'use', label: 'Use / defuse', hint: 'Hold to defuse the spike in Retake' },
    ],
  },
  {
    title: 'Weapons',
    rows: [
      { action: 'primary', label: 'Primary weapon' },
      { action: 'secondary', label: 'Sidearm' },
      { action: 'swap', label: 'Swap weapon', hint: 'The mouse wheel always swaps too' },
      { action: 'loadout', label: 'Weapon menu' },
    ],
  },
  {
    title: 'Map and interface',
    rows: [
      { action: 'mapToggle', label: 'Map (open / close)', keyboardOnly: true },
      { action: 'mapHold', label: 'Map and scoreboard (hold)', keyboardOnly: true },
    ],
  },
];

/** Keys that can't be bound: Esc pauses and releases the mouse. */
export const RESERVED_KEYS = new Set(['Escape']);

const NAMED: Record<string, string> = {
  Mouse0: 'Left click',
  Mouse1: 'Middle click',
  Mouse2: 'Right click',
  Mouse3: 'Mouse 4',
  Mouse4: 'Mouse 5',
  Space: 'Space',
  ShiftLeft: 'L Shift',
  ShiftRight: 'R Shift',
  ControlLeft: 'L Ctrl',
  ControlRight: 'R Ctrl',
  AltLeft: 'L Alt',
  AltRight: 'R Alt',
  MetaLeft: 'L Cmd',
  MetaRight: 'R Cmd',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  CapsLock: 'Caps Lock',
  Enter: 'Enter',
  Backspace: 'Backspace',
};

/** A slot's code as players know the key: 'KeyW' → 'W', 'Digit1' → '1', 'Mouse0' → 'Left click'. */
export function keyLabel(code: string): string {
  if (!code) return '';
  if (NAMED[code]) return NAMED[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return `Num ${code.slice(6)}`;
  if (/^F\d+$/.test(code)) return code;
  if (/^Mouse\d$/.test(code)) return `Mouse ${Number(code.slice(5)) + 1}`;
  return code;
}

/** The labels of an action's keys joined for a hint: 'M', 'L Ctrl / C'. Unbound shows as '—'. */
export function keysOf(keys: KeyBindings, action: BindAction): string {
  const set = (keys[action] ?? ['', '']).filter(Boolean).map(keyLabel);
  return set.length ? set.join(' / ') : '—';
}

/** Saved bindings, checked: every action present with two string slots (anything else falls back to the default). */
export function cleanKeys(raw: unknown): KeyBindings {
  const out = { ...DEFAULT_KEYS };
  if (!raw || typeof raw !== 'object') return out;
  for (const action of Object.keys(DEFAULT_KEYS) as BindAction[]) {
    const v = (raw as Record<string, unknown>)[action];
    if (Array.isArray(v) && v.length === 2 && v.every((s) => typeof s === 'string')) out[action] = [v[0], v[1]] as [string, string];
  }
  return out;
}

/**
 * Put `code` in one slot of `action`, taking it off any other action (and the other slot) that had it.
 * Returns the new bindings and the action it was taken from, if any.
 */
export function bindKey(keys: KeyBindings, action: BindAction, slot: 0 | 1, code: string): { keys: KeyBindings; movedFrom: BindAction | null } {
  const next = Object.fromEntries(Object.entries(keys).map(([a, s]) => [a, [...s] as [string, string]])) as KeyBindings;
  let movedFrom: BindAction | null = null;
  if (code) {
    for (const a of Object.keys(next) as BindAction[])
      for (const i of [0, 1] as const)
        if (next[a][i] === code && !(a === action && i === slot)) {
          next[a][i] = '';
          if (a !== action) movedFrom = a;
        }
  }
  next[action][slot] = code;
  // keep a single key in the first slot
  if (!next[action][0] && next[action][1]) next[action] = [next[action][1], ''];
  return { keys: next, movedFrom };
}
