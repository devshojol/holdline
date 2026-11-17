/**
 * Drawing other players between snapshots (docs/multiplayer.md, section 6.3).
 *
 * Snapshots arrive 30 times a second and not evenly. Each remote player keeps its last few and is
 * drawn where it was a short time ago, blended between the two snapshots around that moment.
 */
import type { WeaponId } from '../../types';
import { PF_ALIVE, PF_GROUNDED, PF_WALKING, type PlayerSnapshot } from '../../net/protocol';

export interface RemoteState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  crouch: number;
  /** Horizontal speed in m/s, from the distance between the two snapshots. */
  speed: number;
  alive: boolean;
  grounded: boolean;
  walking: boolean;
  weapon: WeaponId;
}

interface Sample {
  /** Server time in ms. */
  t: number;
  s: PlayerSnapshot;
}

const MAX_SAMPLES = 32;
/** With no newer snapshot for this long the player is shown standing where they were last seen. */
const STALE_MS = 250;

function lerp(a: number, b: number, k: number) {
  return a + (b - a) * k;
}

/** Blend two angles the short way round. */
function lerpAngle(a: number, b: number, k: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

export class RemoteTrack {
  private samples: Sample[] = [];

  /** Server time of the newest snapshot this player was in. */
  get newest() {
    return this.samples.length ? this.samples[this.samples.length - 1].t : -Infinity;
  }

  push(t: number, s: PlayerSnapshot) {
    if (t <= this.newest) return;
    this.samples.push({ t, s });
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
  }

  /** Forget the past: after a respawn the player must not be drawn sliding from where they died. */
  clear() {
    this.samples = [];
  }

  /** The player at server time `t`, or null before the first snapshot. */
  at(t: number): RemoteState | null {
    const n = this.samples.length;
    if (n === 0) return null;
    let a = this.samples[0];
    let b = a;
    if (t >= this.samples[n - 1].t) {
      a = b = this.samples[n - 1];
    } else if (t > a.t) {
      for (let i = n - 1; i > 0; i--) {
        if (this.samples[i - 1].t <= t) {
          a = this.samples[i - 1];
          b = this.samples[i];
          break;
        }
      }
    }
    const span = b.t - a.t;
    const k = span > 0 ? (t - a.t) / span : 0;
    const dist = Math.hypot(b.s.pos[0] - a.s.pos[0], b.s.pos[2] - a.s.pos[2]);
    let speed = span > 0 ? (dist / span) * 1000 : 0;
    // at the newest sample: keep the speed of the last stretch for a moment so the legs don't freeze between packets
    if (a === b && n >= 2 && t - a.t < STALE_MS) {
      const p = this.samples[n - 2];
      speed = (Math.hypot(a.s.pos[0] - p.s.pos[0], a.s.pos[2] - p.s.pos[2]) / (a.t - p.t)) * 1000;
    }
    return {
      x: lerp(a.s.pos[0], b.s.pos[0], k),
      y: lerp(a.s.pos[1], b.s.pos[1], k),
      z: lerp(a.s.pos[2], b.s.pos[2], k),
      yaw: lerpAngle(a.s.yaw, b.s.yaw, k),
      pitch: lerp(a.s.pitch, b.s.pitch, k),
      crouch: lerp(a.s.crouch, b.s.crouch, k),
      speed,
      alive: (b.s.flags & PF_ALIVE) !== 0,
      grounded: (b.s.flags & PF_GROUNDED) !== 0,
      walking: (b.s.flags & PF_WALKING) !== 0,
      weapon: b.s.weapon,
    };
  }
}

/**
 * The server's clock as seen from here. Each snapshot says what time it was sent; the estimate follows
 * those gently, so one late packet doesn't make every remote player jump.
 */
export class ServerClock {
  private offset = 0;
  private synced = false;

  /** A snapshot stamped `serverTime` arrived at local time `now` (both ms). */
  observe(serverTime: number, now: number) {
    const d = serverTime - now;
    // a big disagreement means a new match or a long stall: start again rather than drift for seconds
    if (!this.synced || Math.abs(d - this.offset) > 500) {
      this.offset = d;
      this.synced = true;
    } else this.offset += (d - this.offset) * 0.1;
  }

  /** The time of the newest snapshot we would have by local time `now`. */
  time(now: number) {
    return now + this.offset;
  }
}
