import type { SessionStats } from '../types';
import { WEAPONS } from '../game/weapons/weaponConfigs';
import { Stat } from './ui';
import { DIFFICULTY_LABEL, MODE_INFO, accuracy, avgMs, fmtDuration, hsPct, locationName, mapName } from '../utils/labels';

const p = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');

export function SessionReportBody({ s }: { s: SessionStats }) {
  const rt = avgMs(s.reactionTimes);
  const kt = avgMs(s.killTimes);
  return (
    <div>
      <div className="mb-4 text-sm text-mute">
        {MODE_INFO[s.mode].label} · {mapName(s.mapId)} / {locationName(s.mapId, s.locationId)} ({s.side === 'attack' ? 'Attacking' : 'Defending'}) ·{' '}
        {DIFFICULTY_LABEL[s.difficulty]} · {fmtDuration(s.durationSec)}
      </div>
      {s.mode === 'spray' && (
        <div className="mb-2 grid grid-cols-2 gap-2 md:grid-cols-4">
          <Stat label="Avg spray score" value={s.spray ? Math.round(s.spray.avgScore) : '—'} sub="0 = no control, 100 = perfect" accent />
          <Stat label="Best spray" value={s.spray ? s.spray.bestScore : '—'} sub={`${s.spray?.sprays ?? 0} sprays scored`} />
          <Stat label="Avg error" value={s.spray ? `${s.spray.avgErrorDeg.toFixed(2)}°` : '—'} sub="from the first-shot point" />
          <Stat label="Tight bullets" value={s.spray ? `${Math.round(s.spray.avgTightPct)}%` : '—'} sub="within 0.6° (a head at 15 m)" />
        </div>
      )}
      <div className={s.mode === 'spray' ? 'hidden' : 'grid grid-cols-2 gap-2 md:grid-cols-4'}>
        <Stat label="Score" value={s.score} accent />
        <Stat label="Enemies down / you went down" value={`${s.kills} / ${s.deaths}`} />
        <Stat label="Shots that hit" value={`${accuracy(s)}%`} sub={`${s.hits} of ${s.shots} shots`} />
        <Stat label="Hits to the head" value={`${hsPct(s)}%`} sub={`${s.headshots} head · ${s.bodyshots} body · ${s.legshots} legs`} />
        <Stat label="Reaction time" value={rt ? `${(rt / 1000).toFixed(2)} s` : '—'} sub="from seeing an enemy to shooting" />
        <Stat label="Time to take one down" value={kt ? `${(kt / 1000).toFixed(2)} s` : '—'} sub="from first seeing them" />
        <Stat label="First bullet hits" value={p(s.firstShotHits, s.firstShots)} sub={`of ${s.firstShots} opening shots`} />
        <Stat label="Stood still to shoot" value={p(s.firstShots - (s.firstShotsMoving ?? 0), s.firstShots)} sub={`${s.firstShotsMoving ?? 0} times you fired on the move`} />
        <Stat label="Hits when holding fire" value={p(s.sprayHits, s.sprayShots)} sub="from the 4th bullet on" />
        <Stat label="Hits while running" value={p(s.movingHits, s.movingShots)} sub={`${s.movingShots} shots on the move`} />
        <Stat label="Damage dealt" value={`${s.damageDealt}`} sub={`you took ${s.damageTaken}`} />
        {s.clear && <Stat label={s.mode === 'retake' ? 'Charges defused' : 'Rounds cleared'} value={`${s.clear.cleared} / ${s.clear.rounds}`} sub={s.mode === 'retake' ? 'before the fuse ran out' : 'defenders all down'} />}
        {s.clear && (
          <Stat
            label={s.mode === 'retake' ? 'Avg time to defuse' : 'Avg clear time'}
            value={s.clear.times.length ? `${(s.clear.times.reduce((a, t) => a + t, 0) / s.clear.times.length).toFixed(1)} s` : '—'}
            sub={s.clear.times.length ? `best ${Math.min(...s.clear.times).toFixed(1)} s` : 'no round cleared'}
          />
        )}
        {s.mode !== 'deathmatch' && !s.clear && <Stat label="Escapes" value={s.escapes} sub="bots that peeked & lived" />}
        {s.mode === 'jiggle' && <Stat label="Baited shots" value={s.baitedShots} sub="missed shots at jiggles" />}
      </div>
      {Object.keys(s.perWeapon).length > 0 && (
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-widest text-dim">
              <th className="py-1.5">Weapon</th>
              <th>Shots</th>
              <th>Hits</th>
              <th>Acc.</th>
              <th>HS</th>
              <th>Kills</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(s.perWeapon).map(([id, w]) => (
              <tr key={id} className="border-t border-line">
                <td className="py-1.5 font-semibold">{WEAPONS[id as keyof typeof WEAPONS]?.name ?? id}</td>
                <td className="tabular">{w!.shots}</td>
                <td className="tabular">{w!.hits}</td>
                <td className="tabular">{p(w!.hits, w!.shots)}</td>
                <td className="tabular">{w!.headshots}</td>
                <td className="tabular">{w!.kills}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
