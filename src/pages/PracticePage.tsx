import { Copy, Play, SlidersHorizontal } from 'lucide-react';
import { useMemo, useState, type CSSProperties } from 'react';
import { WeaponIcon } from '../components/WeaponIcon';
import type { BotBehavior, BotTuning, BotWeapons, Difficulty, PracticeConfig, PracticeMode, Side, WeaponId } from '../types';
import { store, useAppStore } from '../hooks/useAppStore';
import { Button, Card, Cycler, PageHeader, Segmented, Slider, Toggle, cx } from '../components/ui';
import { MapPreview, mapDataFor } from '../components/MapPreview';
import { MAP_SUMMARIES, getMapDefinition } from '../game/maps/registry';
import { DIFFICULTY_PRESETS } from '../settings/defaults';
import { BEHAVIOR_INFO, DIFFICULTY_LABEL, MODE_INFO, fmtDuration } from '../utils/labels';
import { PRIMARY_WEAPONS, SECONDARY_WEAPONS, WEAPONS } from '../game/weapons/weaponConfigs';
import { spotUsableFrom } from '../game/practice/PracticeDirector';
import { exportSetupCode, importSetupCode } from '../utils/setupCode';

/** Guns to choose from, each with its picture. */
function GunPicker({ ids, value, onChange }: { ids: readonly WeaponId[]; value: WeaponId; onChange: (id: WeaponId) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
      {ids.map((id) => {
        const w = WEAPONS[id];
        const on = id === value;
        return (
          <button key={id} type="button" aria-pressed={on} onClick={() => onChange(id)} className="tal-gun" style={{ '--gun': w.color } as CSSProperties}>
            <WeaponIcon id={id} className="h-7 w-full" color={on ? w.color : 'currentColor'} />
            <span className="font-display text-sm font-bold uppercase tracking-wider">{w.name}</span>
          </button>
        );
      })}
    </div>
  );
}

function usableSpotIds(cfg: PracticeConfig): Set<string> {
  const def = getMapDefinition(cfg.mapId);
  const data = mapDataFor(cfg.mapId);
  const loc = def.locations.find((l) => l.id === cfg.locationId) ?? def.locations[0];
  const setup = loc.sides[cfg.side];
  const sp = setup.playerSpawns.find((s) => s.id === cfg.playerSpawnId) ?? setup.playerSpawns[0];
  const out = new Set<string>();
  for (const s of setup.enemySpots) if (spotUsableFrom(data.world, sp, s)) out.add(s.id);
  return out;
}

/** Normalise a config so spawn/spots always belong to the selected map/location/side. */
export function normaliseConfig(cfg: PracticeConfig): PracticeConfig {
  const def = getMapDefinition(cfg.mapId);
  const loc = def.locations.find((l) => l.id === cfg.locationId) ?? def.locations[0];
  const setup = loc.sides[cfg.side];
  const spawn = setup.playerSpawns.find((s) => s.id === cfg.playerSpawnId) ?? setup.playerSpawns[0];
  const spotIds = cfg.enemySpotIds.filter((id) => setup.enemySpots.some((s) => s.id === id));
  return { ...cfg, mapId: def.id, locationId: loc.id, playerSpawnId: spawn.id, enemySpotIds: spotIds };
}

const DURATIONS = [60, 120, 180, 300, 0];

export function PracticePage() {
  const raw = useAppStore((s) => s.practice);
  const cfg = useMemo(() => normaliseConfig(raw), [raw]);
  const [advanced, setAdvanced] = useState(cfg.difficulty === 'custom');
  const [code, setCode] = useState('');
  const [tab, setTab] = useState<'loadout' | 'bots' | 'match'>('loadout');
  const [codeMsg, setCodeMsg] = useState('');
  const def = getMapDefinition(cfg.mapId);
  const loc = def.locations.find((l) => l.id === cfg.locationId)!;
  const setup = loc.sides[cfg.side];
  const usable = useMemo(() => usableSpotIds(cfg), [cfg]);
  const selectedSpots = cfg.enemySpotIds.length ? cfg.enemySpotIds : setup.enemySpots.map((s) => s.id);
  const activeSpots = selectedSpots.filter((id) => usable.has(id));
  const roundMode = cfg.mode === 'site-clear' || cfg.mode === 'retake';
  const maxBots = cfg.mode === 'deathmatch' ? 10 : roundMode ? Math.max(1, Math.min(6, setup.enemySpots.length)) : Math.max(1, activeSpots.length);

  const update = (patch: Partial<PracticeConfig>) => store.updatePractice(normaliseConfig({ ...cfg, ...patch }));

  const toggleSpot = (id: string) => {
    if (!usable.has(id)) return;
    const current = new Set(selectedSpots);
    if (current.has(id)) current.delete(id);
    else current.add(id);
    if (current.size === 0) return;
    const ids = setup.enemySpots.map((s) => s.id).filter((x) => current.has(x));
    update({ enemySpotIds: ids.length === setup.enemySpots.length ? [] : ids });
  };

  const setDifficulty = (d: Difficulty) => {
    if (d === 'custom') {
      update({ difficulty: 'custom' });
      setAdvanced(true);
    } else update({ difficulty: d, tuning: DIFFICULTY_PRESETS[d] });
  };
  const tune = (patch: Partial<BotTuning>) => update({ difficulty: 'custom', tuning: { ...cfg.tuning, ...patch } });

  const start = () => {
    const botCount = Math.min(cfg.botCount, maxBots);
    store.play({ ...cfg, botCount });
  };

  const tabs: { id: typeof tab; label: string }[] = [
    { id: 'loadout', label: 'Loadout' },
    { id: 'bots', label: 'Bots' },
    { id: 'match', label: 'Match' },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader kicker="Practice vs bots" title="Practice" />

      <div className="grid min-h-0 flex-1 grid-cols-[250px_minmax(0,1fr)_330px] gap-4">
        {/* left: what to play, and where */}
        <div className="flex min-h-0 flex-col gap-3">
          <Card className="!p-3">
            <div className="mb-2 font-label text-xs font-semibold uppercase tracking-[0.25em] text-dim">Mode</div>
            <div className="grid gap-1">
              {(Object.keys(MODE_INFO) as PracticeMode[]).map((m) => (
                <button
                  key={m}
                  title={MODE_INFO[m].desc}
                  onClick={() => update({ mode: m, botCount: m === 'deathmatch' ? Math.max(cfg.botCount, 4) : Math.min(cfg.botCount, 3) })}
                  aria-pressed={m === cfg.mode}
                  className={cx('border px-2.5 py-1.5 text-left font-display text-sm uppercase transition-colors', m === cfg.mode ? 'border-accent bg-accent/15 text-ink' : 'border-white/10 bg-black/20 text-mute hover:text-ink')}
                >
                  {MODE_INFO[m].label}
                </button>
              ))}
            </div>
          </Card>
          <Card className="min-h-0 flex-1 !p-3">
            <div className="mb-2 font-label text-xs font-semibold uppercase tracking-[0.25em] text-dim">Map</div>
            <div className="grid grid-cols-2 gap-1">
              {MAP_SUMMARIES.map((m) => (
                <button
                  key={m.id}
                  disabled={!m.playable}
                  onClick={() => update({ mapId: m.id })}
                  aria-pressed={m.id === cfg.mapId}
                  title={m.setting}
                  className={cx('border px-2 py-1.5 text-left font-display text-sm uppercase transition-colors', m.id === cfg.mapId ? 'border-accent bg-accent/15 text-ink' : 'border-white/10 bg-black/20 text-mute hover:text-ink', !m.playable && 'opacity-40')}
                >
                  {m.name}
                </button>
              ))}
            </div>
          </Card>
        </div>

        {/* middle: the map, with your spawn and the enemy positions to click */}
        <Card className="flex min-h-0 flex-col !p-3">
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <Segmented value={cfg.locationId} onChange={(v) => update({ locationId: v, playerSpawnId: '', enemySpotIds: [] })} options={def.locations.map((l) => ({ value: l.id, label: l.name, title: l.description }))} />
            <span className="flex-1" />
            <Segmented
              value={cfg.side}
              onChange={(v: Side) => update({ side: v, playerSpawnId: '', enemySpotIds: [] })}
              options={[
                { value: 'attack', label: 'Attack' },
                { value: 'defend', label: 'Defend' },
              ]}
            />
          </div>
          <div className="relative min-h-0 flex-1">
            <div className="absolute inset-0 grid place-items-center">
              <div className="aspect-square h-full max-w-full border border-line bg-[#0c1218]">
                <MapPreview
                  mapId={cfg.mapId}
                  locationId={cfg.locationId}
                  side={cfg.side}
                  spawnId={cfg.playerSpawnId}
                  spotIds={activeSpots}
                  onToggleSpot={toggleSpot}
                  onPickSpawn={(id) => update({ playerSpawnId: id, enemySpotIds: [] })}
                  className="h-full w-full"
                />
              </div>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-mute">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-info" /> You · click a blue dot to move
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rotate-45 bg-accent" /> Enemies · click to turn on or off ({activeSpots.length} on)
            </span>
          </div>
        </Card>

        {/* right: loadout, bots and match rules in tabs, and the start button */}
        <div className="flex min-h-0 flex-col gap-3">
          <Card className="flex min-h-0 flex-1 flex-col !p-3">
            <div className="mb-3 grid grid-cols-3 gap-1">
              {tabs.map((t) => (
                <button key={t.id} type="button" aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)} className="tal-slab py-2 font-display text-sm uppercase">
                  {t.label}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1">
              {tab === 'loadout' && (
                <div className="space-y-3">
                  <div>
                    <div className="mb-1.5 font-label text-xs font-semibold uppercase tracking-[0.25em] text-dim">Primary</div>
                    <GunPicker ids={PRIMARY_WEAPONS} value={cfg.primary} onChange={(v) => update({ primary: v })} />
                  </div>
                  <div>
                    <div className="mb-1.5 font-label text-xs font-semibold uppercase tracking-[0.25em] text-dim">Sidearm</div>
                    <GunPicker ids={SECONDARY_WEAPONS} value={cfg.secondary} onChange={(v) => update({ secondary: v })} />
                  </div>
                </div>
              )}
              {tab === 'bots' &&
                (cfg.mode === 'spray' ? (
                  <p className="text-sm text-mute">Spray Control has no bots: hold fire at a wall for a full magazine and pull against the recoil. Every spray is scored from 0 to 100.</p>
                ) : advanced ? (
                  <div>
                    <div className="grid grid-cols-2 gap-x-3">
                      <Slider label="Reaction (ms)" value={cfg.tuning.reactionMs} min={100} max={1200} step={10} onChange={(v) => tune({ reactionMs: v })} />
                      <Slider label="Accuracy" value={cfg.tuning.accuracy} min={0} max={1} step={0.01} onChange={(v) => tune({ accuracy: v })} />
                      <Slider label="Peek often" value={cfg.tuning.peekFrequency} min={0} max={1} step={0.01} onChange={(v) => tune({ peekFrequency: v })} />
                      <Slider label="Peek time (s)" value={cfg.tuning.peekDuration} min={0.2} max={3} step={0.05} onChange={(v) => tune({ peekDuration: v })} />
                      <Slider label="Speed" value={cfg.tuning.moveSpeed} min={0.5} max={1.2} step={0.01} onChange={(v) => tune({ moveSpeed: v })} />
                      <Slider label="Aggression" value={cfg.tuning.aggression} min={0} max={1} step={0.01} onChange={(v) => tune({ aggression: v })} />
                      <Slider label="Burst (shots)" value={cfg.tuning.burstLength} min={1} max={12} step={1} onChange={(v) => tune({ burstLength: v })} />
                      <Slider label="Crouching" value={cfg.tuning.crouchChance} min={0} max={1} step={0.01} onChange={(v) => tune({ crouchChance: v })} />
                    </div>
                    <Button variant="ghost" size="sm" className="mt-1" onClick={() => setAdvanced(false)}>
                      ◀ Back to bot settings
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Slider
                      label={cfg.mode === 'deathmatch' ? 'Bots' : roundMode ? 'Defenders per round' : 'Bots peeking at once'}
                      value={Math.min(cfg.botCount, maxBots)}
                      min={1}
                      max={maxBots}
                      onChange={(v) => update({ botCount: Math.round(v) })}
                    />
                    <Cycler label="Difficulty" value={cfg.difficulty} onChange={setDifficulty} options={(['easy', 'normal', 'hard', 'radiant', 'custom'] as Difficulty[]).map((d) => ({ value: d, label: DIFFICULTY_LABEL[d] }))} />
                    <div className="grid grid-cols-2 gap-x-3">
                      <Slider label="Headshots" value={cfg.tuning.headshotChance} min={0} max={1} step={0.01} onChange={(v) => tune({ headshotChance: v })} format={(v) => (v <= 0 ? 'Never' : `${Math.round(v * 100)}%`)} />
                      <Slider label="Their damage" value={cfg.tuning.damageMult} min={0.1} max={1.5} step={0.05} onChange={(v) => tune({ damageMult: v })} format={(v) => `${Math.round(v * 100)}%`} />
                    </div>
                    <Cycler
                      label="Their guns"
                      value={cfg.botWeapons}
                      onChange={(v: BotWeapons) => update({ botWeapons: v })}
                      options={[
                        { value: 'mixed', label: 'Mixed' },
                        { value: 'rifles', label: 'Rifles' },
                        { value: 'pistols', label: 'Sidearms' },
                        { value: 'mirror', label: 'Same as mine' },
                      ]}
                    />
                    {cfg.mode === 'angle-hold' && (
                      <Cycler label="How they peek" value={cfg.behavior} onChange={(v: BotBehavior) => update({ behavior: v })} options={(Object.keys(BEHAVIOR_INFO) as BotBehavior[]).map((b) => ({ value: b, label: BEHAVIOR_INFO[b].label, title: BEHAVIOR_INFO[b].desc }))} />
                    )}
                    <Button variant="ghost" size="sm" onClick={() => setAdvanced(true)}>
                      <SlidersHorizontal size={14} /> Fine-tune bots
                    </Button>
                  </div>
                ))}
              {tab === 'match' && (
                <div className="space-y-1">
                  <Cycler label="Length" value={cfg.durationSec} onChange={(v: number) => update({ durationSec: v })} options={DURATIONS.map((d) => ({ value: d, label: d === 0 ? 'No limit' : fmtDuration(d) }))} />
                  <Toggle
                    label="Bots shoot back"
                    hint={cfg.mode === 'deathmatch' || roundMode ? 'Always on in this mode' : 'Off for pure aim practice'}
                    checked={cfg.botsShootBack || cfg.mode === 'deathmatch' || roundMode}
                    onChange={(v) => update({ botsShootBack: v })}
                  />
                  <Toggle label="Endless ammo" hint="You still reload" checked={cfg.infiniteAmmo} onChange={(v) => update({ infiniteAmmo: v })} />
                  <div className="border-t border-line pt-2">
                    <div className="mb-1.5 text-sm text-mute">Share this setup</div>
                    <div className="flex gap-2">
                      <input
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        placeholder="Paste a setup code"
                        aria-label="Setup code"
                        className="min-w-0 flex-1 border border-line bg-bg/60 px-2 py-1.5 font-mono text-xs text-ink outline-none focus:border-accent"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const loaded = importSetupCode(code);
                          if (!loaded) return setCodeMsg("That code can't be read.");
                          store.updatePractice(normaliseConfig(loaded));
                          setAdvanced(loaded.difficulty === 'custom');
                          setCodeMsg('Setup loaded.');
                        }}
                      >
                        Load
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        title="Copy setup code"
                        onClick={() => {
                          const c = exportSetupCode({ ...cfg, botCount: Math.min(cfg.botCount, maxBots) });
                          setCode(c);
                          navigator.clipboard?.writeText(c).then(
                            () => setCodeMsg('Code copied.'),
                            () => setCodeMsg('The code is in the box.'),
                          );
                        }}
                      >
                        <Copy size={14} />
                      </Button>
                    </div>
                    {codeMsg && <p className="mt-1 text-xs text-mute">{codeMsg}</p>}
                  </div>
                </div>
              )}
            </div>
          </Card>
          <button type="button" data-pulse="true" onClick={start} className="tal-gold flex h-[72px] shrink-0 items-center gap-4 px-5 text-left">
            <Play size={30} className="shrink-0 fill-current" />
            <span className="min-w-0">
              <span className="block font-display text-2xl uppercase leading-none">Start</span>
              <span className="mt-1 block truncate text-sm font-semibold opacity-80">
                {MODE_INFO[cfg.mode].label} · {def.name} · {cfg.mode === 'spray' ? 'no bots' : `${Math.min(cfg.botCount, maxBots)} bots`}
              </span>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
