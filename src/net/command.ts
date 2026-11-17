/**
 * A command is one simulation step of one player's input. The client applies it to its own
 * `PlayerController` at once (prediction) and sends it; the server runs the same command through the
 * same code. See docs/multiplayer.md, section 6.2.
 */
import { ACTIONS, type Action, type ActionSource } from '../game/core/actions';

export interface Command {
  /** Increases by one per command, per player. */
  seq: number;
  /** Length of the step in seconds. The client's step varies with frame rate, so each command carries its own. */
  dt: number;
  /** Bit mask of the actions held during the step (bit = index in `ACTIONS`). */
  held: number;
  /** Bit mask of the actions pressed since the previous command. */
  pressed: number;
  /** View direction in radians, as `PlayerController.yaw` / `.pitch`. */
  yaw: number;
  pitch: number;
  /**
   * Run-speed multiplier from the weapon in hand and aiming down sights (`PlayerController.speedMult`).
   * Sent by the client until the server simulates weapons itself; the server clamps it to the real range.
   */
  speed: number;
}

/** The range `Command.speed` can really take: the slowest is the Operator scoped in, the fastest a sidearm. */
export const MIN_SPEED_MULT = 0.7;
export const MAX_SPEED_MULT = 1.04;
/** Views are kept within a few turns of zero; anything far outside is not a real view direction. */
const MAX_YAW = 64;

/** The client never steps by more than 1/120 s; the server clamps to this so a command can't claim more time. */
export const MAX_COMMAND_DT = 1 / 120 + 1e-6;
const MAX_PITCH = (89 * Math.PI) / 180;

const BIT = Object.fromEntries(ACTIONS.map((a, i) => [a, 1 << i])) as Record<Action, number>;
const ALL_BITS = (1 << ACTIONS.length) - 1;

export function actionBit(a: Action): number {
  return BIT[a];
}

export function actionMask(actions: Iterable<Action>): number {
  let m = 0;
  for (const a of actions) m |= BIT[a];
  return m;
}

/** Read the held and pressed masks from an input device without consuming its presses. */
export function captureMasks(src: { isDown(a: Action): boolean; isPressed(a: Action): boolean }): { held: number; pressed: number } {
  let held = 0;
  let pressed = 0;
  for (const a of ACTIONS) {
    if (src.isDown(a)) held |= BIT[a];
    if (src.isPressed(a)) pressed |= BIT[a];
  }
  return { held, pressed };
}

/**
 * Make a command received from the network safe to simulate: finite numbers, a bounded step, known
 * bits only, pitch within the camera's limits. Returns null when it isn't a command at all.
 */
export function sanitizeCommand(raw: unknown): Command | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const nums = [c.seq, c.dt, c.held, c.pressed, c.yaw, c.pitch, c.speed];
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  const [seq, dt, held, pressed, yaw, pitch, speed] = nums as number[];
  if (!Number.isInteger(seq) || seq < 0 || dt <= 0 || Math.abs(yaw) > MAX_YAW) return null;
  // Values in range pass through untouched: the server must simulate exactly the numbers the client did.
  return {
    seq,
    dt: Math.min(dt, MAX_COMMAND_DT),
    held: held & ALL_BITS,
    pressed: pressed & ALL_BITS,
    yaw,
    pitch: Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch)),
    speed: Math.max(MIN_SPEED_MULT, Math.min(MAX_SPEED_MULT, speed)),
  };
}

/** An `ActionSource` backed by a command: what the server (and the client's replay) feed the simulation. */
export class CommandInput implements ActionSource {
  private held = 0;
  private pressed = 0;

  load(cmd: Command) {
    this.held = cmd.held;
    this.pressed = cmd.pressed;
  }

  isDown(a: Action) {
    return (this.held & BIT[a]) !== 0;
  }

  consume(a: Action) {
    const bit = BIT[a];
    const v = (this.pressed & bit) !== 0;
    this.pressed &= ~bit;
    return v;
  }
}

/** The part of a player the command step drives (`PlayerController` satisfies it). */
interface CommandBody {
  yaw: number;
  pitch: number;
  speedMult: number;
  update(dt: number, input: ActionSource | null): void;
}

/**
 * Advance a player by one command. Client prediction, client replay and the server all step through
 * here, which is what keeps their results identical.
 */
export function applyCommand(body: CommandBody, input: CommandInput, cmd: Command) {
  body.yaw = cmd.yaw;
  body.pitch = cmd.pitch;
  body.speedMult = cmd.speed;
  input.load(cmd);
  body.update(cmd.dt, input);
}
