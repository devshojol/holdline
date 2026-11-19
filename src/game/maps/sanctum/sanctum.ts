/**
 * "Sanctum" — an original hillside monastery with three sites.
 * A (west) via A Long and the narrow A Short sewer, B (centre) from the mid courtyard,
 * C (east) via C Long or through Workshop from mid.
 */
import { GridBuilder } from '../GridMap';
import type { MapDefinition } from '../MapData';
import { authoring, breakLongLanes, location, withGeneratedSpots, type SpotTable } from '../authoring';
import spots from '../generated/sanctum.json';

const COLS = 52;
const ROWS = 48;
const { spawn, spawnAt, focus } = authoring(COLS, ROWS);

function grid(): string[] {
  const g = new GridBuilder(COLS, ROWS, '#');
  // defender spawn and links
  g.rect(17, 1, 34, 4, '.');
  g.set(22, 2, 'c').set(30, 3, 'c');
  g.rect(14, 2, 16, 7, '.'); // → A
  g.rect(24, 5, 27, 6, '.'); // → B
  g.rect(35, 2, 36, 6, '.'); // → C

  // A site
  g.rect(2, 6, 13, 15, '.');
  g.set(6, 9, 'C');
  g.rect(9, 12, 9, 13, 'D');
  g.set(4, 12, 'P');
  g.set(11, 8, 'C');
  g.set(12, 14, 'c');
  // A Long, A Short (sewer), A Lobby
  g.rect(2, 16, 5, 34, '.');
  g.set(4, 27, 'c');
  g.rect(9, 16, 11, 34, '.');
  g.rect(2, 35, 14, 39, '.');
  g.set(7, 37, 'C');
  g.rect(11, 40, 14, 40, '.');

  // attacker spawn
  g.rect(11, 41, 41, 46, '.');
  g.set(18, 43, 'C').set(34, 44, 'C');

  // mid: bottom corridor, courtyard, B Main doors
  g.rect(23, 33, 28, 40, '.');
  g.rect(19, 22, 32, 32, '.');
  g.set(22, 25, 'P');
  g.set(29, 28, 'C');
  g.rect(25, 26, 26, 26, 'c');
  g.rect(24, 17, 27, 21, '.');

  // B site (centre)
  g.rect(19, 7, 32, 16, '.');
  g.set(22, 10, 'C').set(29, 10, 'C');
  g.rect(25, 12, 26, 12, 'C');
  g.set(20, 14, 'c');

  // Workshop (mid → C)
  g.rect(34, 19, 40, 26, '.');
  g.set(36, 22, 'C');
  g.rect(33, 23, 33, 25, '.');
  g.rect(37, 17, 38, 18, '.');

  // C site
  g.rect(37, 6, 49, 16, '.');
  g.set(41, 9, 'C');
  g.rect(45, 12, 46, 12, 'D');
  g.set(39, 13, 'C');
  g.set(47, 8, 'P');
  // C Long, C Lobby
  g.rect(45, 17, 49, 34, '.');
  g.set(46, 25, 'c');
  g.rect(38, 35, 49, 39, '.');
  g.set(43, 37, 'C');
  g.rect(38, 40, 41, 40, '.');
  return g.toStrings();
}

function zoneOf(c: number, r: number) {
  if (r >= 40) return 'atkspawn';
  if (r <= 4 && c >= 17 && c <= 34) return 'defspawn';
  if (c <= 15) return 'a';
  if (c >= 33) return 'c';
  if (r <= 17) return 'b';
  return 'mid';
}

const locations = withGeneratedSpots(
  [
    location({
      id: 'a-long',
      name: 'A Long',
      description: 'Long west lane into A site — a pillar, crates and the stack hold the exit.',
      focus: focus(1, 4, 16, 36),
      attack: [spawn('a-long-mid', 'A Long', 3.5, 25, 0), spawn('a-long-exit', 'Long exit', 3.5, 20, 0)],
      defend: [spawnAt('a-long-site', 'A site', 8, 9, 3.5, 18), spawnAt('a-long-back', 'A back', 11, 11, 3.5, 18)],
    }),
    location({
      id: 'a-short',
      name: 'A Short',
      description: 'The narrow A Short sewer, coming up into the middle of A site.',
      focus: focus(1, 4, 16, 36),
      attack: [spawn('a-short-mid', 'A Short', 10, 24, 0), spawn('a-short-exit', 'Short exit', 10, 19, 0)],
      defend: [spawnAt('a-short-left', 'A left', 4, 10, 10, 17), spawnAt('a-short-right', 'A right', 12, 10, 10, 17)],
    }),
    location({
      id: 'mid',
      name: 'Mid',
      description: 'Mid courtyard with its column and planters, looking up the B Main doors.',
      focus: focus(16, 5, 36, 41),
      attack: [spawn('mid-bottom', 'Mid bottom', 25.5, 34, 0), spawn('mid-court', 'Courtyard', 25.5, 31.5, 0)],
      defend: [spawn('mid-b-main', 'B Main doors', 25.5, 18, 180), spawn('mid-b-site', 'B site', 24.5, 15, 180)],
    }),
    location({
      id: 'workshop',
      name: 'Workshop',
      description: 'Workshop door into C site, crossfired from C boxes and the stack.',
      focus: focus(31, 4, 50, 28),
      attack: [spawnAt('workshop-door', 'Workshop door', 36, 20, 37.5, 15), spawnAt('workshop-in', 'Inside Workshop', 38, 23, 37.5, 15)],
      defend: [spawnAt('workshop-c-site', 'C site', 42, 11, 37.5, 18), spawnAt('workshop-c-left', 'C left', 39, 9, 37.5, 18)],
    }),
    location({
      id: 'c-long',
      name: 'C Long',
      description: 'C Long into a wide C site with the pillar and back stack.',
      focus: focus(31, 4, 50, 36),
      attack: [spawn('c-long-mid', 'C Long', 47, 26, 0), spawn('c-long-exit', 'Long exit', 47, 20, 0)],
      defend: [spawnAt('c-long-site', 'C site', 44, 9, 47, 18), spawnAt('c-long-boxes', 'C boxes', 40, 11, 47, 18)],
    }),
  ],
  spots as unknown as SpotTable,
);

export const sanctum: MapDefinition = {
  id: 'sanctum',
  name: 'Sanctum',
  setting: 'Temple compound',
  theme: 'Hillside monastery, three sites',
  description:
    'Original three-site layout: A Long and the A Short sewer on the west, a central B site above the mid courtyard, and Workshop and C Long leading to C.',
  grid: breakLongLanes(grid(), locations),
  zoneOf,
  callouts: [
    { name: 'A Site', c: 7, r: 11 },
    { name: 'A Long', c: 3.5, r: 28 },
    { name: 'A Short', c: 10, r: 27 },
    { name: 'A Lobby', c: 8, r: 37 },
    { name: 'B Site', c: 25.5, r: 9 },
    { name: 'Mid', c: 25.5, r: 29 },
    { name: 'Mid Bottom', c: 25.5, r: 37 },
    { name: 'Workshop', c: 37, r: 24 },
    { name: 'C Site', c: 43, r: 10 },
    { name: 'C Long', c: 47, r: 28 },
    { name: 'C Lobby', c: 43, r: 37.5 },
    { name: 'Defender Spawn', c: 25.5, r: 2.5 },
    { name: 'Attacker Spawn', c: 26, r: 44 },
  ],
  locations,
  palette: {
    sky: ['#3f8fdc', '#e4f0f8'],
    fog: '#e2ecf2',
    clouds: 0.9,
    uniformShade: 0.55,
    kit: { roofColor: '#3d6470', landmark: 'pagoda', prop: 'lantern', string: 'banners', crateColor: '#a8703c' },
    mood: { sun: '#fff4dc', sunDir: [-0.55, -0.74, 0.4], sunIntensity: 1.65, ambient: '#d2e2fb', bounce: '#cfc8b4', saturation: 42 },
    zones: {
      a: { wall: '#f1e7d0', floor: '#b9b4a6', accent: '#c8392f' },
      b: { wall: '#f4ecd8', floor: '#bdb8aa', accent: '#2f8a4f' },
      c: { wall: '#ece0c6', floor: '#b3aea0', accent: '#2f6fb8' },
      mid: { wall: '#efe4cc', floor: '#b6b1a3', accent: '#d9a52a' },
      defspawn: { wall: '#e6dfcc', floor: '#aeaa9d', accent: '#2e9c8a' },
      atkspawn: { wall: '#eedcc0', floor: '#b5ad9c', accent: '#e05a47' },
    },
  },
  siteMarks: [
    { letter: 'A', c: 3.5, r: 7.5 },
    { letter: 'B', c: 21, r: 8 },
    { letter: 'C', c: 48, r: 14.5 },
  ],
};
