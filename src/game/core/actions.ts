/**
 * The actions a player can perform and the narrow interface the simulation reads them through.
 *
 * This file has no DOM dependency: the browser's `Input` class implements `ActionSource` from the
 * keyboard and mouse, and a multiplayer server implements it from a received command (`src/net/command.ts`).
 */

export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'walk'
  | 'crouch'
  | 'jump'
  | 'reload'
  /** Hold to defuse the spike (retake mode). */
  | 'use'
  | 'primary'
  | 'secondary'
  /** Swap to the other weapon (mouse wheel). */
  | 'swap'
  | 'fire'
  | 'alt'
  /** Open the weapon menu. */
  | 'loadout';

/** Every action, in a fixed order. The position of an action is its bit in a command's masks: append only. */
export const ACTIONS: readonly Action[] = [
  'forward',
  'back',
  'left',
  'right',
  'walk',
  'crouch',
  'jump',
  'reload',
  'use',
  'primary',
  'secondary',
  'swap',
  'fire',
  'alt',
  'loadout',
];

/** What the player and weapon simulation need from an input device. */
export interface ActionSource {
  /** True while the action's key or button is held. */
  isDown(a: Action): boolean;
  /** True once per press: reading it clears it. */
  consume(a: Action): boolean;
}
