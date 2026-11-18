import type { MapSummary } from '../../types';
import { vellora } from './vellora/vellora';
import { dunehold } from './dunehold/dunehold';
import { coralis } from './coralis/coralis';
import { sanctum } from './sanctum/sanctum';
import { permafrost } from './permafrost/permafrost';
import { tamarind } from './tamarind/tamarind';
import { kitsune } from './kitsune/kitsune';
import { goldline } from './goldline/goldline';
import type { MapDefinition } from './MapData';

/** Every playable map, in menu order. */
export const MAP_DEFINITIONS: MapDefinition[] = [vellora, dunehold, sanctum, kitsune, tamarind, permafrost, coralis, goldline];

const BY_ID: Record<string, MapDefinition> = Object.fromEntries(MAP_DEFINITIONS.map((m) => [m.id, m]));

export const MAP_SUMMARIES: MapSummary[] = MAP_DEFINITIONS.map((m) => ({
  id: m.id,
  name: m.name,
  setting: m.setting,
  theme: m.theme,
  playable: true,
  locations: m.locations.map((l) => ({ id: l.id, name: l.name })),
}));

export function getMapDefinition(id: string): MapDefinition {
  return BY_ID[id] ?? vellora;
}

export const DEFAULT_MAP_ID = vellora.id;
