/**
 * "Permafrost" — an original arctic container yard.
 * Both sites are mazes of stacked shipping containers. Mid runs through the Furnace yard,
 * with the Canteen leading to B and a link to A.
 */
import { GridBuilder } from '../GridMap';
import type { MapDefinition } from '../MapData';
import { authoring, breakLongLanes, location, withGeneratedSpots, type SpotTable } from '../authoring';
import spots from '../generated/permafrost.json';

const COLS = 52;
const ROWS = 48;
const { spawn, spawnAt, focus } = authoring(COLS, ROWS);

function grid(): string[] {
  const g = new GridBuilder(COLS, ROWS, '#');
  // defender spawn + links
  g.rect(18, 1, 33, 4, '.');
  g.set(22, 2, 'D').set(29, 3, 'c');
  g.rect(17, 2, 17, 6, '.');
  g.rect(24, 5, 27, 12, '.');
  g.rect(34, 2, 35, 6, '.');

  // A site — container maze
  g.rect(2, 5, 16, 17, '.');
  g.rect(5, 8, 6, 8, 'D');
  g.rect(10, 7, 10, 8, 'D');
  g.rect(13, 11, 14, 11, 'D');
  g.rect(4, 13, 5, 13, 'C');
  g.rect(8, 12, 8, 13, 'C');
  g.rect(11, 15, 12, 15, 'D');
  g.set(15, 14, 'c');
  // A Main, A Lobby
  g.rect(4, 18, 8, 33, '.');
  g.set(8, 28, 'C');
  g.rect(2, 34, 13, 39, '.');
  g.rect(5, 36, 6, 36, 'D');
  g.rect(10, 40, 13, 40, '.');

  // Mid: furnace yard, A link, Canteen to B, mid bottom
  g.rect(20, 13, 31, 30, '.');
  g.rect(24, 22, 25, 23, 'D'); // furnace
  g.set(21, 17, 'C');
  g.set(29, 26, 'C');
  g.rect(28, 15, 29, 15, 'D');
  g.set(22, 28, 'c');
  g.rect(17, 13, 19, 15, '.'); // A link
  g.rect(32, 14, 35, 19, '.'); // canteen
  g.set(33, 18, 'c');
  g.rect(23, 31, 28, 40, '.');

  // B site — container maze
  g.rect(36, 5, 49, 17, '.');
  g.rect(39, 8, 40, 8, 'D');
  g.rect(44, 7, 44, 8, 'D');
  g.rect(46, 12, 47, 12, 'D');
  g.rect(38, 13, 38, 14, 'C');
  g.rect(42, 15, 43, 15, 'C');
  g.rect(42, 11, 43, 11, 'D'); // yellow
  // B Main (green), B Lobby
  g.rect(43, 18, 47, 33, '.');
  g.set(47, 30, 'c');
  g.rect(38, 34, 49, 39, '.');
  g.rect(42, 36, 43, 36, 'D');
  g.rect(38, 40, 41, 40, '.');

  // attacker spawn
  g.rect(10, 41, 41, 46, '.');
  g.rect(18, 43, 19, 43, 'D');
  g.set(33, 44, 'C');
  return g.toStrings();
}

function zoneOf(c: number, r: number) {
  if (r >= 40) return 'atkspawn';
  if (r <= 4 && c >= 17 && c <= 35) return 'defspawn';
  if (c <= 16) return 'a';
  if (c >= 36) return 'b';
  return 'mid';
}

const locations = withGeneratedSpots(
  [
    location({
      id: 'a-main',
      name: 'A Main',
      description: 'A Main into the container maze, where every stack hides an angle.',
      focus: focus(1, 3, 20, 35),
      attack: [spawn('a-main-mid', 'A Main', 6, 26, 0), spawn('a-main-exit', 'A Main exit', 6, 21, 0)],
      defend: [spawnAt('a-site', 'A site', 9, 10, 6, 19), spawnAt('a-site-right', 'A right', 14, 9, 6, 19)],
    }),
    location({
      id: 'mid',
      name: 'Mid',
      description: 'Furnace yard: hold or take mid around the furnace stack and crates.',
      focus: focus(15, 4, 37, 41),
      attack: [spawn('mid-bottom', 'Mid Bottom', 25.5, 34, 0), spawn('mid-yard', 'Furnace yard', 25.5, 30.5, 0)],
      defend: [spawn('mid-top', 'Mid Top', 25.5, 14.5, 180), spawnAt('mid-top-left', 'Mid Top (left)', 22, 14, 25.5, 30)],
    }),
    location({
      id: 'b-main',
      name: 'B Main',
      description: 'B Crane into the yellow container stacks on B site.',
      focus: focus(31, 3, 50, 35),
      attack: [spawn('b-main-mid', 'B Main', 45, 26, 0), spawn('b-main-exit', 'B Main exit', 45, 21, 0)],
      defend: [spawnAt('b-site', 'B site', 41, 10, 45, 19), spawnAt('b-site-back', 'B back', 48, 9, 45, 19)],
    }),
  ],
  spots as unknown as SpotTable,
);

export const permafrost: MapDefinition = {
  id: 'permafrost',
  name: 'Permafrost',
  setting: 'Arctic port',
  theme: 'Arctic container yard',
  description:
    'Original layout: container mazes on both sites, a furnace yard in mid, and a Canteen leading to B.',
  grid: breakLongLanes(grid(), locations),
  zoneOf,
  callouts: [
    { name: 'A Site', c: 9, r: 11 },
    { name: 'A Main', c: 6, r: 28 },
    { name: 'A Lobby', c: 7, r: 38 },
    { name: 'A Link', c: 18, r: 14 },
    { name: 'Furnace', c: 25.5, r: 25 },
    { name: 'Mid Top', c: 25.5, r: 15 },
    { name: 'Mid Bottom', c: 25.5, r: 35 },
    { name: 'Canteen', c: 34, r: 16.5 },
    { name: 'B Site', c: 42, r: 13 },
    { name: 'B Crates', c: 42.5, r: 10 },
    { name: 'B Crane', c: 45, r: 28 },
    { name: 'B Lobby', c: 44, r: 38 },
    { name: 'Defender Spawn', c: 25.5, r: 2.5 },
    { name: 'Attacker Spawn', c: 26, r: 44 },
  ],
  locations,
  palette: {
    sky: ['#3d8fe0', '#e6f2fb'],
    fog: '#e4eef6',
    clouds: 0.5,
    uniformShade: 0.55,
    kit: { roof: 'flat', roofColor: '#4f6478', awnings: false, bunting: false, wallUnits: true, landmark: 'crane', crateColor: '#d8792f', prop: 'drum', snow: true },
    mood: { sun: '#fbf7ee', sunDir: [-0.6, -0.62, 0.42], sunIntensity: 1.55, ambient: '#c6dbfa', bounce: '#ccd9e6', ambientIntensity: 0.88, saturation: 18 },
    zones: {
      a: { wall: '#e6eef5', floor: '#cdd8e2', accent: '#1f6fd0' },
      b: { wall: '#eaf0f3', floor: '#d0dae1', accent: '#f0b429' },
      mid: { wall: '#dfe9f0', floor: '#c6d2dc', accent: '#2fa86a' },
      defspawn: { wall: '#d8e3ea', floor: '#c0ccd6', accent: '#2e9c8a' },
      atkspawn: { wall: '#e4e8ec', floor: '#c8ced4', accent: '#d8402f' },
    },
  },
  siteMarks: [
    { letter: 'A', c: 3.5, r: 9 },
    { letter: 'B', c: 48, r: 15.5 },
  ],
};
