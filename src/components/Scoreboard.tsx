import { Trophy } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import type { ScoreLine, Team } from '../net/protocol';
import type { RoomSettings } from '../net/settings';
import { mapName } from '../utils/labels';
import { cx } from './ui';

const TEAM_NAME: Record<Team, string> = { a: 'Team A', b: 'Team B' };

/**
 * A match's scoreboard, best first. Shown while Tab is held in a match, and with `winner` set on the
 * room page once the match is over (`undefined` = still playing, `null` = a draw).
 */
export function Scoreboard({ scores, settings, me, winner }: { scores: ScoreLine[]; settings: RoomSettings; me: string | null; winner?: string | Team | null }) {
  const teams = settings.mode === 'team-deathmatch';
  const total = (t: Team) => scores.filter((s) => s.team === t).reduce((n, s) => n + s.kills, 0);
  const over = winner !== undefined;
  const winnerName = winner === 'a' || winner === 'b' ? TEAM_NAME[winner] : scores.find((s) => s.id === winner)?.name;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
        <div>
          <div className="font-display text-xs font-semibold uppercase tracking-[0.25em] text-accent">{teams ? 'Team Deathmatch' : 'Deathmatch'}</div>
          <div className="font-display text-2xl font-bold uppercase leading-none text-ink">{mapName(settings.mapId)}</div>
        </div>
        {over ? (
          <div className="flex items-center gap-2 font-display text-xl font-bold uppercase text-ink">
            <Trophy size={20} className="text-warn" />
            {winner === null ? 'Draw' : winner === me ? 'You win' : `${winnerName ?? 'Nobody'} wins`}
          </div>
        ) : (
          <div className="text-xs uppercase tracking-widest text-dim">{settings.killLimit > 0 ? `First to ${settings.killLimit} kills` : 'No kill limit'}</div>
        )}
      </div>

      {teams && (
        <div className="mb-3 grid grid-cols-2 gap-2">
          {(['a', 'b'] as Team[]).map((t) => (
            <div key={t} className={cx('flex items-baseline justify-between border px-3 py-2', winner === t ? 'border-warn/60 bg-warn/10' : 'border-line bg-bg/50')}>
              <span className="font-display text-sm font-semibold uppercase tracking-wider text-mute">{TEAM_NAME[t]}</span>
              <span className="font-display tabular text-2xl font-bold text-ink">{total(t)}</span>
            </div>
          ))}
        </div>
      )}

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-widest text-dim">
            <th className="w-8 py-1.5 font-normal">#</th>
            <th className="py-1.5 font-normal">Player</th>
            {teams && <th className="py-1.5 font-normal">Team</th>}
            <th className="w-20 py-1.5 pl-3 text-right font-normal">Kills</th>
            <th className="w-20 py-1.5 pl-3 text-right font-normal">Deaths</th>
            <th className="w-20 py-1.5 pl-3 text-right font-normal">Assists</th>
            <th className="w-20 py-1.5 pl-3 text-right font-normal">HS %</th>
            <th className="w-20 py-1.5 pl-3 text-right font-normal">Ping</th>
          </tr>
        </thead>
        <tbody>
          {scores.map((s, i) => (
            <tr key={s.id} className={cx('border-t border-line', s.id === me ? 'bg-accent/10 text-ink' : 'text-mute')}>
              <td className="tabular py-1.5 text-dim">{i + 1}</td>
              <td className="max-w-0 truncate py-1.5 text-ink">
                {s.name}
                {s.id === me && <span className="ml-2 text-xs text-dim">you</span>}
                {s.bot && <span className="ml-2 border border-white/15 px-1 text-xs font-semibold uppercase tracking-wider text-dim">Bot</span>}
              </td>
              {teams && <td className="py-1.5">{s.team ? TEAM_NAME[s.team] : '—'}</td>}
              <td className="tabular py-1.5 text-right font-semibold text-ink">{s.kills}</td>
              <td className="tabular py-1.5 text-right">{s.deaths}</td>
              <td className="tabular py-1.5 text-right">{s.assists}</td>
              <td className="tabular py-1.5 text-right">{s.kills > 0 ? Math.round((s.headshots / s.kills) * 100) : 0}</td>
              <td className="tabular py-1.5 text-right text-dim">{!s.bot && s.ping >= 0 ? `${s.ping} ms` : '—'}</td>
            </tr>
          ))}
          {scores.length === 0 && (
            <tr className="border-t border-line">
              <td colSpan={teams ? 8 : 7} className="py-3 text-center text-dim">
                No players
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];

/**
 * How a match ended, as a game shows it: the verdict in large letters, where you placed, then the
 * full scoreboard. `children` goes under the verdict (a countdown, a Play again button).
 */
export function MatchResultView({ scores, settings, winner, me, children }: { scores: ScoreLine[]; settings: RoomSettings; winner: string | Team | null; me: string | null; children?: ReactNode }) {
  const mine = scores.find((s) => s.id === me);
  const place = mine ? scores.indexOf(mine) : -1;
  const won = winner !== null && (winner === me || (mine?.team != null && winner === mine.team));
  const verdict = winner === null ? 'Draw' : won ? 'Victory' : 'Defeat';
  // gold for a win, the accent red for a loss, neutral for a draw
  const look = (won ? { '--ink': '#ffe9a8', '--glow': 'rgba(242,193,78,0.34)', '--edge': 'rgba(242,193,78,0.55)' } : winner === null ? { '--ink': '#ece8e1', '--glow': 'rgba(138,150,165,0.2)', '--edge': 'rgba(138,150,165,0.4)' } : { '--ink': '#ff8b95', '--glow': 'rgba(255,70,85,0.3)', '--edge': 'rgba(255,70,85,0.55)' }) as CSSProperties;
  return (
    <section aria-label="Match result" className="mb-5">
      <div className="tal-result" style={look}>
        <div className="font-display text-xs font-semibold uppercase tracking-[0.4em] text-mute">Match over · {mapName(settings.mapId)}</div>
        <div className="tal-result-title">{verdict}</div>
        {mine && (
          <div className="mt-2 text-sm text-mute">
            You placed <span className="font-semibold text-ink">{ORDINAL[place] ?? `${place + 1}th`}</span> of {scores.length} with{' '}
            <span className="font-semibold text-ink">{mine.kills}</span> {mine.kills === 1 ? 'kill' : 'kills'} and <span className="font-semibold text-ink">{mine.deaths}</span>{' '}
            {mine.deaths === 1 ? 'death' : 'deaths'}
          </div>
        )}
        {children && <div className="mt-4 flex flex-wrap items-center justify-center gap-3">{children}</div>}
      </div>
      <div className="tal-card tal-panel border border-t-0 p-5">
        <Scoreboard scores={scores} settings={settings} me={me} winner={winner} />
      </div>
    </section>
  );
}
