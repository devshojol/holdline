/**
 * Helpers shared by the grid-authored map definitions.
 */
import type { EnemySpot, MapLocation, Side, SpawnPoint } from '../../types';
import { CELL, GridSpace } from './GridMap';

export type SpotTable = Record<string, Partial<Record<Side, EnemySpot[]>>>;

export function authoring(cols: number, rows: number) {
  const S = new GridSpace(cols, rows);
  const yawTo = (fromC: number, fromR: number, toC: number, toR: number) =>
    (Math.atan2(S.x(toC) - S.x(fromC), S.z(toR) - S.z(fromR)) * 180) / Math.PI;
  const spawn = (id: string, name: string, c: number, r: number, yaw: number, y = 0): SpawnPoint => ({
    id,
    name,
    pos: [S.x(c), y, S.z(r)],
    yaw,
  });
  /** Spawn facing a target cell. */
  const spawnAt = (id: string, name: string, c: number, r: number, toC: number, toR: number, y = 0): SpawnPoint =>
    spawn(id, name, c, r, yawTo(c, r, toC, toR), y);
  const focus = (c0: number, r0: number, c1: number, r1: number) => ({
    minX: S.x(c0) - 2,
    maxX: S.x(c1) + 2,
    minZ: S.z(r1) - 2,
    maxZ: S.z(r0) + 2,
  });
  return { S, yawTo, spawn, spawnAt, focus };
}

/** Fill empty enemy-spot lists from the generated spot table. */
export function withGeneratedSpots(locations: MapLocation[], table: SpotTable): MapLocation[] {
  return locations.map((l) => ({
    ...l,
    sides: {
      attack: { ...l.sides.attack, enemySpots: l.sides.attack.enemySpots.length ? l.sides.attack.enemySpots : (table[l.id]?.attack ?? []) },
      defend: { ...l.sides.defend, enemySpots: l.sides.defend.enemySpots.length ? l.sides.defend.enemySpots : (table[l.id]?.defend ?? []) },
    },
  }));
}

export interface LocationDraft {
  id: string;
  name: string;
  description: string;
  focus: MapLocation['focus'];
  attack: SpawnPoint[];
  defend: SpawnPoint[];
}

export function location(d: LocationDraft): MapLocation {
  return {
    id: d.id,
    name: d.name,
    description: d.description,
    focus: d.focus,
    sides: { attack: { playerSpawns: d.attack, enemySpots: [] }, defend: { playerSpawns: d.defend, enemySpots: [] } },
  };
}

/** A straight street at least this many cells long gets cover (30 m). */
const LANE_LONG = 20;
/** Cells of open street before the first cover and between covers. */
const LANE_GAP = 9;

/**
 * Break up the longest straight streets, so nobody is shot from further away than they can make out who
 * is shooting. Where a street two to four cells wide runs straight for 30 m or more, tall crates are set
 * as a chicane: one side of the street blocked, and three cells on the other side, so the sight line along
 * it is cut while there is always a way through. Cells near a practice spawn (and near hand-placed enemy
 * spots, when `guardSpots` is set) are left alone.
 */
export function breakLongLanes(grid: string[], locations: MapLocation[], guardSpots = false): string[] {
  const rows = grid.length;
  const cols = grid[0].length;
  const S = new GridSpace(cols, rows);
  const g = grid.map((row) => row.split(''));
  const plain = (c: number, r: number) => r >= 0 && r < rows && c >= 0 && c < cols && g[r][c] === '.';
  const guarded = new Uint8Array(cols * rows);
  const guard = (x: number, z: number, rad: number) => {
    for (let r = S.row(z + rad * CELL); r <= S.row(z - rad * CELL); r++)
      for (let c = S.col(x - rad * CELL); c <= S.col(x + rad * CELL); c++) if (r >= 0 && r < rows && c >= 0 && c < cols) guarded[r * cols + c] = 1;
  };
  for (const loc of locations)
    for (const side of [loc.sides.attack, loc.sides.defend]) {
      for (const sp of side.playerSpawns) guard(sp.pos[0], sp.pos[2], 3);
      if (guardSpots)
        for (const e of side.enemySpots) {
          guard(e.cover[0], e.cover[2], 2);
          guard(e.cover[0] + e.peekDir[0] * e.maxPeek, e.cover[2] + e.peekDir[1] * e.maxPeek, 2);
        }
    }
  for (const vertical of [true, false]) {
    const length = vertical ? rows : cols;
    const width = vertical ? cols : rows;
    const at = (along: number, across: number) => (vertical ? plain(across, along) : plain(along, across));
    const isGuarded = (along: number, across: number) => {
      const c = vertical ? across : along;
      const r = vertical ? along : across;
      return r < 0 || r >= rows || c < 0 || c >= cols || guarded[r * cols + c] === 1;
    };
    const put = (along: number, across: number) => {
      if (vertical) g[along][across] = 'C';
      else g[across][along] = 'C';
    };
    /** The street's cross-section through (along, across), as "from,to". */
    const span = (along: number, across: number) => {
      let a = across;
      while (at(along, a - 1)) a--;
      let b = across;
      while (at(along, b + 1)) b++;
      return [a, b];
    };
    for (let across = 0; across < width; across++) {
      let along = 0;
      while (along < length) {
        if (!at(along, across)) {
          along++;
          continue;
        }
        let end = along;
        while (end + 1 < length && at(end + 1, across)) end++;
        if (end - along + 1 >= LANE_LONG) {
          let since = 0;
          for (let k = along + 1; k + 3 <= end - LANE_GAP + 2; k++) {
            if (++since < LANE_GAP) continue;
            const [a, b] = span(k, across);
            const w = b - a + 1;
            if (w < 2 || w > 4) continue;
            // the same straight piece of street from one cell before the chicane to one after
            let straight = true;
            for (let kk = k - 1; kk <= k + 4 && straight; kk++) {
              const [a2, b2] = span(kk, across);
              if (a2 !== a || b2 !== b) straight = false;
              for (let x = a; x <= b && straight; x++) if (isGuarded(kk, x)) straight = false;
            }
            if (!straight) continue;
            const half = Math.ceil(w / 2);
            for (let x = a; x < a + half; x++) put(k, x);
            for (let x = a + half; x <= b; x++) put(k + 3, x);
            since = 0;
            k += 3;
          }
        }
        along = end + 1;
      }
    }
  }
  return g.map((row) => row.join(''));
}
