import type { Vec3 } from '../../types';
import type { ClientMessage, ServerMessage } from '../../net/protocol';
import type { AgentId } from '../agents';

/** What the game engine needs from the connection to play a multiplayer match. */
export interface NetLink {
  /** This player's id in the match. */
  playerId: string;
  /** Where the server put this player. */
  spawn: { pos: Vec3; yaw: number };
  /** Server time (ms) the match ends. */
  endsAt: number;
  /** The display name of a player in the match. */
  nameOf(id: string): string;
  /** The agent a player in the match plays as, once the server has said. */
  agentOf(id: string): AgentId | null;
  /** The team a player is on (null outside Team Deathmatch, or before the server has said). */
  teamOf(id: string): 'a' | 'b' | null;
  send(msg: ClientMessage): void;
  /** Set by the engine: called for every snapshot and match event. */
  onMessage: ((msg: ServerMessage) => void) | null;
  /** Testing: cut the connection, as a network failure would. It reconnects by itself. */
  drop(): void;
  /** Testing: delay everything sent and received by `ms` in total (half each way), give or take `jitter`. */
  setLag(ms: number, jitter?: number): void;
}
