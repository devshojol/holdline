import { ChartColumn, Check, ChevronRight, Crosshair, Flame, Play, SlidersHorizontal, Swords, Users, type LucideIcon } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { PracticeConfig, PracticeMode } from '../types';
import { store, useAppStore } from '../hooks/useAppStore';
import { Badge, Button, cx } from '../components/ui';
import { MapPreview } from '../components/MapPreview';
import { WeaponIcon } from '../components/WeaponIcon';
import { WEAPONS } from '../game/weapons/weaponConfigs';
import { getMapDefinition } from '../game/maps/registry';
import { DIFFICULTY_LABEL, MODE_INFO, accuracy, dayKey, fmtDate, hsPct, locationName } from '../utils/labels';
import { normaliseConfig } from './PracticePage';

const DAILY: { mode: PracticeMode; title: string; target: string; patch: Partial<PracticeConfig> }[] = [
  { mode: 'angle-hold', title: 'Warm-up: hold A Main', target: '2 min angle hold', patch: { locationId: 'a-main', side: 'defend', behavior: 'mixed', durationSec: 120, botCount: 2 } },
  { mode: 'jiggle', title: "Don't take the bait", target: '2 min jiggle drill', patch: { locationId: 'mid', side: 'attack', durationSec: 120, botCount: 2 } },
  { mode: 'site-clear', title: 'Take the site', target: '3 min site clear', patch: { locationId: 'a-main', side: 'attack', durationSec: 180, botCount: 3 } },
  { mode: 'retake', title: 'Defuse under pressure', target: '3 min retake', patch: { locationId: 'a-main', side: 'attack', durationSec: 180, botCount: 3 } },
  { mode: 'deathmatch', title: 'Live fire', target: '5 min deathmatch', patch: { durationSec: 300, botCount: 5 } },
];
const ROUTINE_MINUTES = Math.round(DAILY.reduce((a, d) => a + (d.patch.durationSec ?? 0), 0) / 60);

/** One line of the main menu. */
function MenuItem({ index, label, hint, icon: Icon, primary, onClick }: { index: number; label: string; hint: string; icon: LucideIcon; primary?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} data-primary={primary} className="tal-menu-item tal-rise" style={{ '--i': index } as CSSProperties}>
      <span className={cx('font-display tabular w-7 text-sm font-bold', primary ? 'text-white/70' : 'text-dim')}>{String(index + 1).padStart(2, '0')}</span>
      <span className="min-w-0 flex-1">
        <span className={cx('block font-display font-bold uppercase leading-none tracking-[0.08em]', primary ? 'text-3xl' : 'text-2xl')}>{label}</span>
        <span className={cx('mt-1 block truncate text-xs', primary ? 'text-white/80' : 'text-mute')}>{hint}</span>
      </span>
      <Icon size={primary ? 26 : 20} className={primary ? 'text-white' : 'text-dim'} />
    </button>
  );
}

/** A titled block in the right-hand column. */
function Panel({ title, right, children, index }: { title: string; right?: React.ReactNode; children: React.ReactNode; index: number }) {
  return (
    <section className="tal-card tal-panel tal-rise border p-4" style={{ '--i': index } as CSSProperties}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="tal-card-title font-display text-base font-semibold uppercase tracking-[0.14em] text-ink">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function HomePage() {
  const practice = useAppStore((s) => s.practice);
  const sessions = useAppStore((s) => s.sessions);
  const routineHistory = useAppStore((s) => s.routineHistory);
  const cfg = normaliseConfig(practice);
  const last = sessions[0];
  const today = dayKey(Date.now());
  const todays = sessions.filter((s) => dayKey(s.startedAt) === today);
  const def = getMapDefinition(cfg.mapId);
  const primary = WEAPONS[cfg.primary];
  const secondary = WEAPONS[cfg.secondary];
  const routineToday = routineHistory.find((r) => r.day === today)?.total;

  const quick = () => store.play(cfg);
  const drill = (d: (typeof DAILY)[number]) => normaliseConfig({ ...practice, ...d.patch, mode: d.mode, playerSpawnId: '', enemySpotIds: [] });
  const routine = () =>
    store.startRoutine(
      DAILY.map(drill),
      DAILY.map((d) => d.title),
    );

  return (
    <div className="grid gap-6 lg:h-full lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)_minmax(300px,360px)] lg:gap-8">
      {/* ---- left: title and main menu (above the tilted map, whose corners reach over the column edges) ---- */}
      <div className="relative z-10 flex min-h-0 flex-col justify-center">
        <div className="mb-6">
          <div className="font-display text-xs font-semibold uppercase tracking-[0.4em] text-accent">Tactical shooter training</div>
          <h1 className="tal-title-in mt-1 font-display text-6xl font-extrabold uppercase leading-[0.86] tracking-[0.04em] text-ink xl:text-7xl">
            Tactical
            <br />
            <span className="text-accent">Aim Lab</span>
          </h1>
          <p className="mt-3 max-w-xs text-sm text-mute">Win the gunfight before the round.</p>
        </div>
        <nav aria-label="Main menu" className="space-y-2">
          <MenuItem index={0} primary label="Quick practice" hint={`${MODE_INFO[cfg.mode].label} · ${def.name} · ${locationName(cfg.mapId, cfg.locationId)}`} icon={Play} onClick={quick} />
          <MenuItem index={1} label="Custom setup" hint="Map, location, bots, difficulty, weapons" icon={SlidersHorizontal} onClick={() => store.go('practice')} />
          <MenuItem index={2} label="Multiplayer" hint="A room with friends, or a quick match" icon={Users} onClick={() => store.go('multiplayer')} />
          <MenuItem index={3} label="Daily routine" hint={`${DAILY.length} drills back to back · ${ROUTINE_MINUTES} min`} icon={Flame} onClick={routine} />
          <MenuItem index={4} label="Armory" hint="Every weapon, its damage and recoil" icon={Swords} onClick={() => store.go('weapons')} />
          <MenuItem index={5} label="Career" hint={sessions.length ? `${sessions.length} sessions recorded` : 'Your results and progress'} icon={ChartColumn} onClick={() => store.go('statistics')} />
        </nav>
      </div>

      {/* ---- centre: the next drill on the map table ---- */}
      <div className="flex min-h-0 min-w-0 flex-col">
        <div className="tal-rise flex flex-wrap items-end justify-between gap-x-6 gap-y-2" style={{ '--i': 1 } as CSSProperties}>
          <div>
            <div className="font-display text-xs font-semibold uppercase tracking-[0.3em] text-info">Next drill</div>
            <div className="font-display text-4xl font-bold uppercase leading-none tracking-[0.05em]">{def.name}</div>
            <div className="mt-1 text-sm text-mute">
              {MODE_INFO[cfg.mode].label} · {cfg.side === 'attack' ? 'Attacking' : 'Defending'} · {primary.name}
            </div>
          </div>
          <Badge tone="accent">{DIFFICULTY_LABEL[cfg.difficulty]}</Badge>
        </div>

        <div className="tal-holo relative my-2 min-h-[220px] flex-1">
          <div className="absolute inset-0 grid place-items-center">
            <div className="tal-holo-plate aspect-square h-[88%] max-h-[600px] max-w-[88%]">
              <MapPreview mapId={cfg.mapId} locationId={cfg.locationId} side={cfg.side} spawnId={cfg.playerSpawnId} spotIds={cfg.enemySpotIds} focus={false} className="h-full w-full" />
              <div className="tal-holo-scan" />
            </div>
          </div>
        </div>

        <div className="tal-rise" style={{ '--i': 3 } as CSSProperties}>
          <div className="mb-2 text-xs uppercase tracking-widest text-dim">Location</div>
          <div className="flex flex-wrap gap-1.5">
            {def.locations.map((l) => (
              <button
                key={l.id}
                title={l.description}
                aria-pressed={l.id === cfg.locationId}
                onClick={() => store.updatePractice(normaliseConfig({ ...practice, locationId: l.id, playerSpawnId: '', enemySpotIds: [] }))}
                className={cx(
                  'border px-3 py-1.5 font-display text-sm font-semibold uppercase tracking-wider transition-colors',
                  l.id === cfg.locationId ? 'border-accent bg-accent/20 text-ink' : 'border-white/10 bg-black/30 text-mute hover:border-mute hover:text-ink',
                )}
              >
                {l.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ---- right: loadout, daily drills, last session ---- */}
      <div className="relative z-10 flex min-h-0 flex-col justify-center gap-4 lg:overflow-y-auto lg:pr-1">
        <Panel index={2} title="Loadout" right={<Badge>{primary.category}</Badge>}>
          <WeaponIcon id={primary.id} className="h-14 w-full" color={primary.color} />
          <div className="mt-2 flex items-end justify-between gap-3">
            <div>
              <div className="font-display text-3xl font-bold uppercase leading-none" style={{ color: primary.color }}>
                {primary.name}
              </div>
              <div className="mt-1 text-xs text-mute">
                {primary.fireRate} rounds/s · {primary.magazine} in the magazine · {primary.damage[0].head} to the head
              </div>
            </div>
            <div className="shrink-0 text-right">
              <WeaponIcon id={secondary.id} className="ml-auto h-6 w-16" color="#8a96a5" />
              <div className="font-display text-sm font-semibold uppercase tracking-wider text-mute">{secondary.name}</div>
            </div>
          </div>
        </Panel>

        <Panel
          index={3}
          title="Daily training"
          right={
            <span className="text-xs text-dim">
              {todays.length} today{routineToday !== undefined && ` · routine ${routineToday}`}
            </span>
          }
        >
          <div className="space-y-1">
            {DAILY.map((d) => {
              const done = todays.some((s) => s.mode === d.mode);
              return (
                <button
                  key={d.mode}
                  onClick={() => store.play(drill(d))}
                  className={cx('flex w-full items-center gap-2.5 border px-2.5 py-1.5 text-left transition-colors', done ? 'border-ok/30 bg-ok/5' : 'border-white/10 bg-black/20 hover:border-mute')}
                >
                  <span className={cx('grid h-5 w-5 shrink-0 place-items-center border', done ? 'border-ok text-ok' : 'border-line text-dim')}>{done ? <Check size={12} /> : <Crosshair size={11} />}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{d.title}</span>
                  <span className="shrink-0 text-xs text-mute">{d.target}</span>
                  <ChevronRight size={14} className="shrink-0 text-dim" />
                </button>
              );
            })}
          </div>
        </Panel>

        <Panel index={4} title="Last session" right={last ? <span className="text-xs text-dim">{fmtDate(last.startedAt)}</span> : undefined}>
          {last ? (
            <>
              <div className="font-display text-lg font-bold uppercase leading-tight">
                {MODE_INFO[last.mode].label} <span className="text-mute">· {locationName(last.mapId, last.locationId)}</span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                {(
                  [
                    ['Score', last.score],
                    ['Accuracy', `${accuracy(last)}%`],
                    ['Headshots', `${hsPct(last)}%`],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="border border-white/10 bg-black/25 py-1.5">
                    <div className="font-display tabular text-2xl font-bold leading-none text-ink">{value}</div>
                    <div className="mt-0.5 text-[10px] uppercase tracking-widest text-dim">{label}</div>
                  </div>
                ))}
              </div>
              <Button className="mt-3 w-full" variant="outline" size="sm" onClick={quick}>
                <Play size={14} /> Continue previous drill
              </Button>
            </>
          ) : (
            <p className="text-sm text-mute">
              No sessions yet. Start with <span className="text-ink">Quick practice</span>: your history and progress build up from there.
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}
