/**
 * Client-side prediction for the local player (docs/multiplayer.md, section 6.2).
 *
 * Every simulation step becomes a command that is applied here at once and sent to the server. When
 * the server reports where it has the player after a given command, that is compared with what was
 * predicted for the same command. If they differ, the player is put where the server says and the
 * commands the server hasn't seen yet are run again on top.
 */
import type { MotionState, PlayerController } from '../player/PlayerController';
import { CommandInput, applyCommand, type Command } from '../../net/command';
import { PF_CROUCHING, PF_GROUNDED, type SelfSnapshot } from '../../net/protocol';

/** Differences below these are rounding, not disagreement. */
const POS_EPSILON = 1e-4;
const VEL_EPSILON = 1e-3;
/** Commands kept while waiting for the server; beyond this the connection is stalled and the oldest go. */
const MAX_PENDING = 720;

interface Pending {
  cmd: Command;
  /** The predicted state right after this command. */
  after: MotionState;
}

export class Prediction {
  private pending: Pending[] = [];
  private seq = 0;
  private readonly input = new CommandInput();
  /** How many times the server's answer differed from the prediction, and by how far the last time (metres). */
  corrections = 0;
  lastError = 0;

  /** The sequence number of the last command made (-1 before the first). */
  get lastSeq() {
    return this.seq - 1;
  }

  get unacked() {
    return this.pending.length;
  }

  /** Advance the player by one step from the given keys, and return the command to send. */
  step(player: PlayerController, dt: number, held: number, pressed: number): Command {
    const cmd: Command = { seq: this.seq++, dt, held, pressed, yaw: player.yaw, pitch: player.pitch, speed: player.speedMult };
    applyCommand(player, this.input, cmd);
    this.pending.push({ cmd, after: player.motionState() });
    if (this.pending.length > MAX_PENDING) this.pending.shift();
    return cmd;
  }

  /**
   * Check the prediction against the server's state. Returns how far the player was moved
   * ([dx, dy, dz], old position minus new) so the view can ease across the jump, or null when the
   * prediction was right.
   */
  reconcile(player: PlayerController, self: SelfSnapshot): [number, number, number] | null {
    const acked = this.pending.find((p) => p.cmd.seq === self.ackSeq);
    this.pending = this.pending.filter((p) => p.cmd.seq > self.ackSeq);
    const server: MotionState = {
      x: self.pos[0],
      y: self.pos[1],
      z: self.pos[2],
      vx: self.vel[0],
      vy: self.vel[1],
      vz: self.vel[2],
      crouch: self.crouch,
      crouching: (self.flags & PF_CROUCHING) !== 0,
      grounded: (self.flags & PF_GROUNDED) !== 0,
    };
    // what we thought the state was at the same moment: after the acknowledged command, or (when the
    // server is fully caught up, or hasn't run anything of ours yet) where the player stands now
    const predicted = acked?.after ?? (this.pending.length === 0 ? player.motionState() : null);
    if (predicted && same(predicted, server)) return null;

    const before = { x: player.pos.x, y: player.pos.y, z: player.pos.z };
    const { yaw, pitch, speedMult, events } = player;
    player.events = {}; // replayed steps are corrections, not new footsteps and landings
    player.setMotionState(server);
    for (const p of this.pending) {
      applyCommand(player, this.input, p.cmd);
      p.after = player.motionState();
    }
    player.events = events;
    player.yaw = yaw;
    player.pitch = pitch;
    player.speedMult = speedMult;

    const moved: [number, number, number] = [before.x - player.pos.x, before.y - player.pos.y, before.z - player.pos.z];
    const error = Math.hypot(moved[0], moved[1], moved[2]);
    if (error < POS_EPSILON) return null;
    this.corrections++;
    this.lastError = error;
    return moved;
  }

  /** Forget everything in flight (a respawn or a new match: the old commands no longer apply). */
  reset() {
    this.pending = [];
  }
}

function same(a: MotionState, b: MotionState) {
  return (
    Math.abs(a.x - b.x) < POS_EPSILON &&
    Math.abs(a.y - b.y) < POS_EPSILON &&
    Math.abs(a.z - b.z) < POS_EPSILON &&
    Math.abs(a.vx - b.vx) < VEL_EPSILON &&
    Math.abs(a.vy - b.vy) < VEL_EPSILON &&
    Math.abs(a.vz - b.vz) < VEL_EPSILON &&
    Math.abs(a.crouch - b.crouch) < 1e-3 &&
    a.crouching === b.crouching &&
    a.grounded === b.grounded
  );
}
