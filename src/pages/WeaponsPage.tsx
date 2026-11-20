import { Suspense, lazy, useState } from 'react';
import type { WeaponId } from '../types';
import { store, useAppStore } from '../hooks/useAppStore';
import { Badge, Card, PageHeader, Slider, cx } from '../components/ui';
import { SprayPattern } from '../components/Charts';
import { ALL_WEAPONS, WEAPONS } from '../game/weapons/weaponConfigs';
import { RUN_SPEED } from '../game/player/PlayerController';
import { WeaponIcon } from '../components/WeaponIcon';
// loaded on demand: it brings the 3D engine with it, which the menus must not download up front
const GunViewer = lazy(() => import('../components/GunViewer').then((m) => ({ default: m.GunViewer })));

/** 0..1 ratings for the comparison bars, relative to the strongest gun in each column. */
function ratings(id: WeaponId) {
  const w = WEAPONS[id];
  const near = w.damage[0];
  const far = w.damage[w.damage.length - 1];
  return [
    ['Damage', Math.min(1, near.body / 150)],
    ['Fire rate', Math.min(1, w.fireRate / 13.33)],
    ['Range', far.body / near.body],
    ['Mobility', Math.max(0, Math.min(1, (w.runSpeedMult - 0.9) / 0.14))],
    ['Magazine', Math.min(1, w.magazine / 30)],
  ] as [string, number][];
}

const ORDER: WeaponId[] = ALL_WEAPONS;

export function WeaponsPage() {
  const practice = useAppStore((s) => s.practice);
  const sessions = useAppStore((s) => s.sessions);
  const [sel, setSel] = useState<WeaponId>(practice.primary);
  const [bullets, setBullets] = useState(WEAPONS[practice.primary].magazine);
  const [tab, setTab] = useState<'stats' | 'damage' | 'spray'>('stats');
  const w = WEAPONS[sel];
  const usage = sessions.reduce(
    (acc, s) => {
      const l = s.perWeapon[sel];
      if (l) {
        acc.shots += l.shots;
        acc.hits += l.hits;
        acc.hs += l.headshots;
        acc.kills += l.kills;
      }
      return acc;
    },
    { shots: 0, hits: 0, hs: 0, kills: 0 },
  );
  const equipped = practice.primary === sel || practice.secondary === sel;

  const facts: [string, string][] = [
    ['Fire rate', `${w.fireRate}/s · ${w.auto ? 'auto' : 'semi'}`],
    ['Magazine', `${w.magazine} / ${w.reserve}`],
    ['Reload', `${w.reloadTime} s`],
    ['Equip', `${w.equipTime} s`],
    ['Spread (hip / aim)', `${w.spread.base}° / ${w.spread.ads}°`],
    ['Spread per shot', `+${w.spread.firingPerShot}° (max ${w.spread.firingMax}°)`],
    ['Running', `${w.spread.moveMax}° · steady under ${(w.spread.accurateSpeedFraction * RUN_SPEED).toFixed(1)} m/s`],
    ['In the air', `${w.spread.air}°`],
    ['Right click', w.altFire === 'ads' ? (w.ads.scope ? `Scope ${w.ads.zoom}×${w.ads.zoom2 ? ` / ${w.ads.zoom2}×` : ''}` : `Aim ${w.ads.zoom}×`) : `${w.burst?.count}-round burst`],
    ['Recoil recovery', `${w.recoil.recoveryRate}/s after ${w.recoil.recoveryDelay} s`],
    ['Tracers', w.tracer ? 'Visible' : 'Hidden'],
  ];
  const isEquipped = w.slot === 'primary' ? practice.primary === sel : practice.secondary === sel;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader kicker="Your arsenal" title="Loadout" />
      <div className="grid min-h-0 flex-1 grid-cols-[230px_minmax(0,1fr)_330px] gap-4">
        {/* every gun */}
        <div className="flex min-h-0 flex-col gap-1.5">
          {ORDER.map((id) => {
            const x = WEAPONS[id];
            const on = id === sel;
            const eq = practice.primary === id || practice.secondary === id;
            return (
              <button
                key={id}
                onClick={() => {
                  setSel(id);
                  setBullets(x.magazine);
                }}
                aria-pressed={on}
                className={cx('flex min-h-0 flex-1 items-center gap-2 border px-2.5 text-left transition-colors', on ? 'border-accent bg-accent/15' : 'border-white/10 bg-black/30 hover:border-mute')}
              >
                <WeaponIcon id={id} className="h-6 w-16 shrink-0" color={on ? x.color : '#7b8696'} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-sm uppercase" style={{ color: on ? x.color : undefined }}>
                    {x.name}
                  </span>
                  <span className="block truncate text-xs text-dim">{x.category}</span>
                </span>
                {eq && <span className="h-2 w-2 shrink-0 rounded-full bg-ok" title="Equipped" />}
              </button>
            );
          })}
        </div>

        {/* the gun itself */}
        <Card className="flex min-h-0 flex-col !p-4">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <div className="font-label text-xs font-semibold uppercase tracking-[0.25em] text-dim">{w.category}</div>
              <div className="font-display text-4xl uppercase leading-none" style={{ color: w.color }}>
                {w.name}
              </div>
            </div>
            {equipped && <Badge tone="ok">Equipped</Badge>}
          </div>
          <div className="relative my-3 min-h-0 flex-1 border border-line bg-bg/50">
            <Suspense fallback={<div className="h-full" />}>
              <GunViewer
                key={sel}
                id={sel}
                className="absolute inset-0 block h-full w-full"
                fallback={
                  <div className="grid h-full place-items-center p-6">
                    <WeaponIcon id={sel} className="h-28 w-full" color={w.color} />
                  </div>
                }
              />
            </Suspense>
            <div className="pointer-events-none absolute bottom-2 right-3 text-xs uppercase tracking-widest text-dim">Drag to turn</div>
          </div>
          <p className="text-sm text-mute">{w.description}</p>
          <div className="mt-3 grid grid-cols-5 gap-3">
            {ratings(sel).map(([label, v]) => (
              <div key={label}>
                <div className="mb-1 text-xs uppercase tracking-wider text-dim">{label}</div>
                <div className="h-1.5 bg-bg">
                  <div className="h-full transition-[width] duration-300" style={{ width: `${Math.round(v * 100)}%`, background: w.color }} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* numbers, in tabs, and equip */}
        <div className="flex min-h-0 flex-col gap-3">
          <Card className="flex min-h-0 flex-1 flex-col !p-3">
            <div className="mb-3 grid grid-cols-3 gap-1">
              {(['stats', 'damage', 'spray'] as const).map((t) => (
                <button key={t} type="button" aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)} className="tal-slab py-2 font-display text-sm uppercase">
                  {t === 'stats' ? 'Stats' : t === 'damage' ? 'Damage' : 'Spray'}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1">
              {tab === 'stats' && (
                <div className="text-sm">
                  {facts.map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-3 border-b border-line/50 py-[5px]">
                      <span className="text-dim">{k}</span>
                      <span className="truncate text-right tabular">{v}</span>
                    </div>
                  ))}
                  <div className="mt-3 grid grid-cols-4 gap-1 text-center">
                    {[
                      ['Shots', usage.shots],
                      ['Acc.', `${usage.shots ? Math.round((usage.hits / usage.shots) * 100) : 0}%`],
                      ['HS', `${usage.hits ? Math.round((usage.hs / usage.hits) * 100) : 0}%`],
                      ['Kills', usage.kills],
                    ].map(([k, v]) => (
                      <div key={k} className="border border-white/10 bg-black/25 py-1">
                        <div className="font-display text-base tabular text-ink">{v}</div>
                        <div className="text-xs uppercase text-dim">{k}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {tab === 'damage' && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wider text-dim">
                      <th className="py-1.5">Range</th>
                      <th>Head</th>
                      <th>Body</th>
                      <th>Legs</th>
                      <th>To kill</th>
                    </tr>
                  </thead>
                  <tbody>
                    {w.damage.map((d, i) => (
                      <tr key={i} className="border-t border-line">
                        <td className="py-1.5">
                          {i === 0 ? '0' : w.damage[i - 1].maxRange}–{d.maxRange > 500 ? '∞' : d.maxRange} m
                        </td>
                        <td className="tabular text-warn">{d.head}</td>
                        <td className="tabular">{d.body}</td>
                        <td className="tabular">{d.legs}</td>
                        <td className="tabular">{Math.ceil(150 / d.body)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {tab === 'spray' && (
                <div className="flex h-full min-h-0 flex-col">
                  <div className="flex min-h-0 flex-1 justify-center bg-bg/60 py-2">
                    <SprayPattern pattern={w.recoil.pattern} color={w.color} count={bullets} className="h-full w-48" />
                  </div>
                  <Slider label="Bullets shown" value={bullets} min={1} max={w.recoil.pattern.length} onChange={(v) => setBullets(Math.round(v))} />
                </div>
              )}
            </div>
          </Card>
          <button
            type="button"
            disabled={isEquipped}
            onClick={() => store.updatePractice(w.slot === 'primary' ? { primary: sel } : { secondary: sel })}
            className={cx('flex h-16 shrink-0 items-center justify-center font-display text-xl uppercase', isEquipped ? 'tal-slab cursor-default text-mute' : 'tal-gold')}
          >
            {isEquipped ? (w.slot === 'primary' ? 'Your primary' : 'Your sidearm') : w.slot === 'primary' ? 'Equip as primary' : 'Equip as sidearm'}
          </button>
        </div>
      </div>
    </div>
  );
}
