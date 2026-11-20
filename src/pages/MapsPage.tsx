import { Play } from 'lucide-react';
import { useState } from 'react';
import type { Side } from '../types';
import { store, useAppStore } from '../hooks/useAppStore';
import { Card, PageHeader, Segmented, cx } from '../components/ui';
import { MapPreview } from '../components/MapPreview';
import { MAP_DEFINITIONS, getMapDefinition } from '../game/maps/registry';
import { normaliseConfig } from './PracticePage';

export function MapsPage() {
  const practice = useAppStore((s) => s.practice);
  const [mapId, setMapId] = useState(practice.mapId);
  const def = getMapDefinition(mapId);
  const [locId, setLocId] = useState(def.locations[0].id);
  const [side, setSide] = useState<Side>('attack');
  const location = def.locations.find((l) => l.id === locId) ?? def.locations[0];
  const setup = location.sides[side];

  const pickMap = (id: string) => {
    setMapId(id);
    setLocId(getMapDefinition(id).locations[0].id);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader kicker="The battlegrounds" title="Maps" />
      <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)_300px] gap-4">
        {/* every map, small */}
        <div className="grid min-h-0 grid-cols-2 grid-rows-4 gap-2">
          {MAP_DEFINITIONS.map((m) => (
            <button
              key={m.id}
              onClick={() => pickMap(m.id)}
              aria-pressed={m.id === def.id}
              className={cx('flex min-h-0 flex-col border p-1.5 text-left transition-colors', m.id === def.id ? 'border-accent bg-accent/10' : 'border-line bg-panel/80 hover:border-mute')}
            >
              <div className="min-h-0 flex-1 border border-line/60">
                <MapPreview mapId={m.id} focus={false} showSight={false} className="h-full w-full" />
              </div>
              <span className="mt-1 truncate font-display text-sm uppercase">{m.name}</span>
            </button>
          ))}
        </div>

        {/* the chosen map, big */}
        <Card className="flex min-h-0 flex-col !p-3">
          <div className="relative min-h-0 flex-1">
            <div className="absolute inset-0 grid place-items-center">
              <div className="aspect-[52/48] h-full max-w-full border border-line">
                <MapPreview mapId={def.id} locationId={location.id} side={side} focus={false} className="h-full w-full" />
              </div>
            </div>
          </div>
        </Card>

        {/* about it, and play it */}
        <div className="flex min-h-0 flex-col gap-3">
          <Card className="min-h-0 flex-1">
            <div className="font-label text-xs font-semibold uppercase tracking-[0.25em] text-accent">{def.setting}</div>
            <div className="font-display text-3xl uppercase leading-none">{def.name}</div>
            <p className="mt-2 text-sm text-mute">{def.description}</p>
            <div className="mt-4 space-y-2">
              <Segmented value={location.id} onChange={setLocId} options={def.locations.map((l) => ({ value: l.id, label: l.name }))} />
              <Segmented
                value={side}
                onChange={setSide}
                options={[
                  { value: 'attack', label: 'Attack' },
                  { value: 'defend', label: 'Defend' },
                ]}
              />
            </div>
            <p className="mt-3 text-sm text-mute">{location.description}</p>
            <p className="mt-2 text-xs text-dim">
              {setup.playerSpawns.length} spawns · {setup.enemySpots.length} enemy positions
            </p>
          </Card>
          <button
            type="button"
            className="tal-gold flex h-16 shrink-0 items-center justify-center gap-3 font-display text-xl uppercase"
            onClick={() => {
              store.updatePractice(normaliseConfig({ ...practice, mapId: def.id, locationId: location.id, side, playerSpawnId: '', enemySpotIds: [] }));
              store.go('practice');
            }}
          >
            <Play size={22} className="fill-current" /> Practice here
          </button>
        </div>
      </div>
    </div>
  );
}
