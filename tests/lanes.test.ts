/**
 * The cover added to long streets must never close a street off: every ground cell of every map has
 * to stay reachable on foot from every other.
 */
import { describe, expect, it } from 'vitest';
import { MAP_DEFINITIONS } from '../src/game/maps/registry';
import { buildMapData } from '../src/game/maps/MapData';

describe('map layouts', () => {
  for (const def of MAP_DEFINITIONS) {
    it(`${def.id}: all walkable ground is connected`, () => {
      const { nav } = buildMapData(def);
      const { cols, rows, walkable } = nav;
      const total = walkable.reduce((a, b) => a + b, 0);
      const seen = new Uint8Array(cols * rows);
      const queue = [walkable.indexOf(1)];
      seen[queue[0]] = 1;
      for (let head = 0; head < queue.length; head++) {
        const i = queue[head];
        const c = i % cols;
        const r = (i - c) / cols;
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const cc = c + dc;
          const rr = r + dr;
          const j = rr * cols + cc;
          if (cc >= 0 && rr >= 0 && cc < cols && rr < rows && walkable[j] && !seen[j]) {
            seen[j] = 1;
            queue.push(j);
          }
        }
      }
      expect(queue.length).toBe(total);
    });
  }
});
