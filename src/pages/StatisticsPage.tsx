import { Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { PracticeMode, SessionStats, WeaponId } from '../types';
import { store, useAppStore } from '../hooks/useAppStore';
import { Card, ConfirmButton, Cycler, PageHeader, Segmented, Stat } from '../components/ui';
import { LineChart } from '../components/Charts';
import { SessionReportBody } from '../components/SessionReport';
import { WEAPONS } from '../game/weapons/weaponConfigs';
import { MODE_INFO, accuracy, avgMs, dayKey, fmtDate, hsPct, locationName } from '../utils/labels';

function aggregate(list: SessionStats[]) {
  const t = list.reduce(
    (a, s) => {
      a.shots += s.shots;
      a.hits += s.hits;
      a.hs += s.headshots;
      a.kills += s.kills;
      a.deaths += s.deaths;
      a.time += s.durationSec;
      a.rt.push(...s.reactionTimes);
      a.fs += s.firstShots;
      a.fsh += s.firstShotHits;
      a.ss += s.sprayShots;
      a.ssh += s.sprayHits;
      a.ms += s.movingShots;
      a.msh += s.movingHits;
      return a;
    },
    { shots: 0, hits: 0, hs: 0, kills: 0, deaths: 0, time: 0, rt: [] as number[], fs: 0, fsh: 0, ss: 0, ssh: 0, ms: 0, msh: 0 },
  );
  return t;
}

const pc = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

export function StatisticsPage() {
  const sessions = useAppStore((s) => s.sessions);
  const [range, setRange] = useState<'daily' | 'weekly'>('daily');
  const [modeFilter, setModeFilter] = useState<PracticeMode | 'all'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [view, setView] = useState<'matches' | 'progress'>('matches');
  const [side, setSide] = useState<'mode' | 'weapon'>('mode');
  const filtered = modeFilter === 'all' ? sessions : sessions.filter((s) => s.mode === modeFilter);
  const t = aggregate(filtered);

  const buckets = useMemo(() => {
    const map = new Map<string, SessionStats[]>();
    for (const s of [...filtered].reverse()) {
      let key = dayKey(s.startedAt);
      if (range === 'weekly') {
        const d = new Date(s.startedAt);
        const monday = new Date(d);
        monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
        key = 'wk ' + dayKey(monday.getTime()).slice(5);
      } else key = key.slice(5);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return [...map.entries()].slice(-20);
  }, [filtered, range]);

  const weapons = useMemo(() => {
    const m = new Map<WeaponId, { shots: number; hits: number; hs: number; kills: number }>();
    for (const s of filtered)
      for (const [id, w] of Object.entries(s.perWeapon)) {
        const cur = m.get(id as WeaponId) ?? { shots: 0, hits: 0, hs: 0, kills: 0 };
        cur.shots += w!.shots;
        cur.hits += w!.hits;
        cur.hs += w!.headshots;
        cur.kills += w!.kills;
        m.set(id as WeaponId, cur);
      }
    return [...m.entries()];
  }, [filtered]);

  const byMode = (Object.keys(MODE_INFO) as PracticeMode[]).map((m) => {
    const list = sessions.filter((s) => s.mode === m);
    const a = aggregate(list);
    return { m, n: list.length, acc: pc(a.hits, a.shots), hs: pc(a.hs, a.hits), rt: avgMs(a.rt), best: Math.max(0, ...list.map((s) => s.score)) };
  });

  const PER_PAGE = 7;
  const pages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const pageRows = filtered.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
  const shown = open ? filtered.find((s) => s.id === open) : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader kicker="Your record" title="Career">
        <div className="flex items-center gap-3">
          <div className="w-72">
            <Cycler
              label="Mode"
              value={modeFilter}
              onChange={(v) => {
                setModeFilter(v);
                setPage(0);
              }}
              options={[{ value: 'all' as const, label: 'All modes' }, ...(Object.keys(MODE_INFO) as PracticeMode[]).map((m) => ({ value: m, label: MODE_INFO[m].short }))]}
            />
          </div>
          {sessions.length > 0 && (
            <ConfirmButton confirmLabel="Delete all?" onConfirm={() => store.clearSessions()}>
              <Trash2 size={14} /> Clear
            </ConfirmButton>
          )}
        </div>
      </PageHeader>

      <div className="grid shrink-0 grid-cols-8 gap-2">
        <Stat label="Matches" value={filtered.length} sub={`${Math.round(t.time / 60)} min`} />
        <Stat label="Accuracy" value={`${pc(t.hits, t.shots)}%`} sub={`${t.hits}/${t.shots}`} accent />
        <Stat label="Headshots" value={`${pc(t.hs, t.hits)}%`} />
        <Stat label="Reaction" value={t.rt.length ? `${avgMs(t.rt)}` : '—'} sub="ms" />
        <Stat label="K / D" value={t.deaths ? (t.kills / t.deaths).toFixed(2) : t.kills} sub={`${t.kills} kills`} />
        <Stat label="First shot" value={`${pc(t.fsh, t.fs)}%`} />
        <Stat label="Spray" value={`${pc(t.ssh, t.ss)}%`} />
        <Stat label="On the move" value={`${pc(t.msh, t.ms)}%`} sub="lower is better" />
      </div>

      <div className="mt-3 grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_340px] gap-4">
        <Card className="flex min-h-0 flex-col !p-3">
          <div className="mb-2 flex items-center gap-1">
            {(['matches', 'progress'] as const).map((v) => (
              <button key={v} type="button" aria-current={view === v ? 'page' : undefined} onClick={() => setView(v)} className="tal-slab px-4 py-2 font-display text-sm uppercase">
                {v === 'matches' ? 'Matches' : 'Progress'}
              </button>
            ))}
            <span className="flex-1" />
            {view === 'progress' && <Segmented value={range} onChange={setRange} options={[{ value: 'daily' as const, label: 'Daily' }, { value: 'weekly' as const, label: 'Weekly' }]} />}
            {view === 'matches' && !shown && pages > 1 && (
              <div className="flex items-center gap-2 text-sm text-mute">
                <button type="button" className="tal-slab grid h-8 w-8 place-items-center" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} aria-label="Newer">
                  ◀
                </button>
                <span className="tabular">
                  {page + 1} / {pages}
                </span>
                <button type="button" className="tal-slab grid h-8 w-8 place-items-center" disabled={page >= pages - 1} onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} aria-label="Older">
                  ▶
                </button>
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1">
            {view === 'progress' && (
              <div className="grid h-full grid-rows-[3fr_2fr] gap-2">
                <LineChart
                  labels={buckets.map(([k]) => k)}
                  series={[
                    { name: 'Accuracy %', color: '#f5a524', values: buckets.map(([, l]) => { const a = aggregate(l); return pc(a.hits, a.shots); }) },
                    { name: 'Headshot %', color: '#ffd56a', values: buckets.map(([, l]) => { const a = aggregate(l); return pc(a.hs, a.hits); }) },
                  ]}
                  yMax={100}
                  unit="%"
                  height={210}
                />
                <LineChart
                  labels={buckets.map(([k]) => k)}
                  series={[{ name: 'Reaction (ms)', color: '#5cc8ff', values: buckets.map(([, l]) => { const v = avgMs(aggregate(l).rt); return v || null; }) }]}
                  height={130}
                />
              </div>
            )}
            {view === 'matches' && shown && (
              <div className="h-full">
                <button type="button" className="mb-2 text-sm text-mute hover:text-ink" onClick={() => setOpen(null)}>
                  ◀ All matches
                </button>
                <SessionReportBody s={shown} />
              </div>
            )}
            {view === 'matches' && !shown && (
              <>
                {filtered.length === 0 && <div className="grid h-full place-items-center text-sm text-dim">Play a match to start your record.</div>}
                <div className="divide-y divide-line">
                  {pageRows.map((s) => (
                    <button key={s.id} className="flex w-full items-center gap-4 py-2 text-left text-sm hover:bg-white/[0.03]" onClick={() => setOpen(s.id)}>
                      <span className="w-28 shrink-0 text-mute">{fmtDate(s.startedAt)}</span>
                      <span className="w-36 shrink-0 truncate font-semibold">{MODE_INFO[s.mode].label}</span>
                      <span className="w-24 shrink-0 truncate text-mute">{locationName(s.mapId, s.locationId)}</span>
                      <span className="tabular">
                        {s.kills}K / {s.deaths}D
                      </span>
                      <span className="tabular">{accuracy(s)}%</span>
                      <span className="tabular">{hsPct(s)}% HS</span>
                      <span className="ml-auto font-display text-lg tabular text-accent">{s.score}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </Card>

        <Card className="flex min-h-0 flex-col !p-3">
          <div className="mb-2 grid grid-cols-2 gap-1">
            {(['mode', 'weapon'] as const).map((v) => (
              <button key={v} type="button" aria-current={side === v ? 'page' : undefined} onClick={() => setSide(v)} className="tal-slab py-2 font-display text-sm uppercase">
                {v === 'mode' ? 'By mode' : 'By weapon'}
              </button>
            ))}
          </div>
          {side === 'mode' ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-dim">
                  <th className="py-1">Mode</th>
                  <th>N</th>
                  <th>Acc</th>
                  <th>HS</th>
                  <th>Best</th>
                </tr>
              </thead>
              <tbody>
                {byMode.map((r) => (
                  <tr key={r.m} className="border-t border-line">
                    <td className="py-1.5">{MODE_INFO[r.m].short}</td>
                    <td className="tabular">{r.n}</td>
                    <td className="tabular">{r.acc}%</td>
                    <td className="tabular">{r.hs}%</td>
                    <td className="tabular">{r.n ? r.best : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div>
              {weapons.length === 0 && <div className="text-sm text-dim">No shots yet.</div>}
              {weapons.slice(0, 8).map(([id, w]) => (
                <div key={id} className="flex items-center justify-between border-t border-line py-2 text-sm first:border-0">
                  <span className="font-display text-sm uppercase" style={{ color: WEAPONS[id].color }}>
                    {WEAPONS[id].name}
                  </span>
                  <span className="tabular text-mute">
                    {pc(w.hits, w.shots)}% · {pc(w.hs, w.hits)}% HS · {w.kills} K
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
