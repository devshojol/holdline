import { Crosshair, Flame, Gauge, Medal, Shield, Skull, Sparkles, Target, Timer, Trophy, Zap, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { SessionStats } from '../types';
import { SessionReportBody } from './SessionReport';
import { DIFFICULTY_LABEL, MODE_INFO, accuracy, avgMs, fmtDuration, hsPct, mapName } from '../utils/labels';
import { cx } from './ui';

/* ------------------------------------------------------------------ */
/* Grade, XP and medals: all worked out from the stats already kept     */
/* ------------------------------------------------------------------ */

type Grade = 'S' | 'A' | 'B' | 'C' | 'D';
const GRADE_COLOR: Record<Grade, string> = { S: '#ffd56a', A: '#f5a524', B: '#5cc8ff', C: '#9aa86a', D: '#8a96a5' };
const GRADE_WORD: Record<Grade, string> = { S: 'Legendary', A: 'Excellent', B: 'Solid', C: 'Getting there', D: 'Keep at it' };

/** A 0–100 rating of the match: accuracy, headshots, kills against deaths and, in round modes, rounds won. */
export function matchRating(s: SessionStats): number {
  if (s.mode === 'spray') return s.spray ? s.spray.avgScore : 0;
  const acc = accuracy(s);
  const hs = s.hits >= 3 ? hsPct(s) : 0;
  const kd = s.deaths ? s.kills / s.deaths : s.kills;
  let r = acc * 0.9 + hs * 0.45 + Math.min(kd, 3) * 12;
  if (s.clear && s.clear.rounds > 0) r = r * 0.6 + (s.clear.cleared / s.clear.rounds) * 45;
  if (s.kills === 0 && !s.clear) r *= 0.5;
  return Math.max(0, Math.min(100, r));
}

export function gradeOf(rating: number): Grade {
  return rating >= 75 ? 'S' : rating >= 56 ? 'A' : rating >= 40 ? 'B' : rating >= 26 ? 'C' : 'D';
}

/** XP a match earns. */
export function xpOf(s: SessionStats): number {
  return Math.round(Math.max(0, s.score) * 0.5 + s.kills * 25 + s.headshots * 10 + (s.clear?.cleared ?? 0) * 40 + Math.min(300, s.durationSec) * 0.2);
}

/** XP needed to go from `level` to the next one. */
const levelCost = (level: number) => 300 + (level - 1) * 150;

export function levelOf(totalXp: number): { level: number; into: number; need: number } {
  let level = 1;
  let left = totalXp;
  while (left >= levelCost(level)) {
    left -= levelCost(level);
    level++;
  }
  return { level, into: left, need: levelCost(level) };
}

interface MedalDef {
  id: string;
  name: string;
  icon: LucideIcon;
  /** Why it was earned, or (when not) what it takes. */
  earned: (s: SessionStats) => boolean;
  how: string;
}

const MEDALS: MedalDef[] = [
  { id: 'untouchable', name: 'Untouchable', icon: Shield, earned: (s) => s.deaths === 0 && s.kills >= 3, how: '3+ kills without dying' },
  { id: 'rampage', name: 'Rampage', icon: Flame, earned: (s) => s.kills >= 10, how: '10 kills in a match' },
  { id: 'spree', name: 'Killing spree', icon: Skull, earned: (s) => s.kills >= 5 && s.kills < 10, how: '5 kills in a match' },
  { id: 'dominant', name: 'Dominant', icon: Trophy, earned: (s) => s.kills >= 4 && s.kills >= s.deaths * 2, how: 'Twice as many kills as deaths' },
  { id: 'headhunter', name: 'Headhunter', icon: Crosshair, earned: (s) => s.hits >= 5 && hsPct(s) >= 30, how: '30% of hits to the head' },
  { id: 'sharpshooter', name: 'Sharpshooter', icon: Target, earned: (s) => s.shots >= 15 && accuracy(s) >= 35, how: '35% accuracy' },
  { id: 'quickdraw', name: 'Quick draw', icon: Zap, earned: (s) => s.reactionTimes.length >= 3 && avgMs(s.reactionTimes) <= 450, how: 'React in under 0.45 s' },
  {
    id: 'disciplined',
    name: 'Disciplined',
    icon: Gauge,
    earned: (s) => s.firstShots >= 5 && (s.firstShots - (s.firstShotsMoving ?? 0)) / s.firstShots >= 0.8,
    how: 'Stop before 80% of first shots',
  },
  { id: 'cleaner', name: 'Clean sweep', icon: Sparkles, earned: (s) => !!s.clear && s.clear.rounds > 0 && s.clear.cleared === s.clear.rounds, how: 'Win every round' },
  { id: 'steady', name: 'Steady hands', icon: Timer, earned: (s) => !!s.spray && s.spray.avgScore >= 70, how: 'Average spray score of 70' },
];

const applies = (m: MedalDef, s: SessionStats) =>
  s.mode === 'spray' ? m.id === 'steady' : m.id === 'cleaner' ? !!s.clear : m.id !== 'steady';

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

/** Counts up from 0 to `to` once, for the numbers that should feel earned. */
function useCountUp(to: number, ms = 900) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    let raf = 0;
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      setV(Math.round(to * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return v;
}

function BigStat({ label, value, sub, icon: Icon, accent }: { label: string; value: ReactNode; sub?: string; icon: LucideIcon; accent?: boolean }) {
  return (
    <div className={cx('tal-slab flex items-center gap-3 px-4 py-3', accent && '!bg-[linear-gradient(180deg,rgba(74,62,34,0.95),rgba(36,30,18,0.95))]')}>
      <Icon size={26} className="shrink-0 text-accent" />
      <div className="min-w-0">
        <div className="font-label text-xs font-semibold uppercase tracking-[0.2em] text-dim">{label}</div>
        <div className="font-display text-3xl leading-none text-ink">{value}</div>
        {sub && <div className="mt-0.5 truncate text-xs text-mute">{sub}</div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The debrief                                                         */
/* ------------------------------------------------------------------ */

/**
 * The end-of-match screen: a grade for the match, the XP it earned towards your level, the medals you won,
 * the four numbers that matter, and the rest behind a toggle. Fits one screen.
 */
export function MatchDebrief({ s, history, banner, actions }: { s: SessionStats; history: SessionStats[]; banner?: ReactNode; actions: ReactNode }) {
  const [details, setDetails] = useState(false);
  const rating = matchRating(s);
  const grade = gradeOf(rating);
  const xp = xpOf(s);
  const earlier = history.filter((h) => h.id !== s.id);
  const before = levelOf(earlier.reduce((a, h) => a + xpOf(h), 0));
  const after = levelOf(earlier.reduce((a, h) => a + xpOf(h), 0) + xp);
  const levelledUp = after.level > before.level;
  const best = earlier.filter((h) => h.mode === s.mode).reduce((a, h) => Math.max(a, h.score), -Infinity);
  const newBest = earlier.some((h) => h.mode === s.mode) && s.score > best;
  const shownScore = useCountUp(s.score);
  const shownXp = useCountUp(xp, 1100);
  const [fill, setFill] = useState(before.level === after.level ? before.into / before.need : 0);
  useEffect(() => {
    const t = setTimeout(() => setFill(after.into / after.need), 250);
    return () => clearTimeout(t);
  }, [after.into, after.need]);

  const medals = MEDALS.filter((m) => applies(m, s));
  const won = medals.filter((m) => m.earned(s));
  const next = medals.find((m) => !m.earned(s));
  const kd = s.deaths ? (s.kills / s.deaths).toFixed(2) : String(s.kills);
  const color = GRADE_COLOR[grade];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-end justify-between gap-4">
        <div>
          <div className="font-label text-sm font-semibold uppercase tracking-[0.3em] text-accent">Match over</div>
          <div className="font-display text-4xl uppercase leading-none text-ink">Debrief</div>
        </div>
        <div className="text-right text-sm text-mute">
          {MODE_INFO[s.mode].label} · {mapName(s.mapId)} · {DIFFICULTY_LABEL[s.difficulty]} · {fmtDuration(s.durationSec)}
        </div>
      </div>
      {banner}

      <div className="mt-4 grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)] gap-5">
        {/* the grade, the score and your level */}
        <div className="flex min-h-0 flex-col gap-3">
          <div className="tal-slab relative flex flex-col items-center px-4 pb-5 pt-6 text-center" style={{ '--g': color } as CSSProperties}>
            {newBest && <div className="tal-hazard absolute left-0 top-3 px-3 py-0.5 font-display text-xs uppercase text-[#1c1203]">New best</div>}
            <div className="relative grid h-36 w-36 place-items-center">
              <div className="tal-grade absolute inset-3" style={{ borderColor: color, boxShadow: `0 0 40px -6px ${color}88, inset 0 0 30px -10px ${color}66` }} />
              <span className="relative font-display text-7xl leading-none" style={{ color, textShadow: `0 0 34px ${color}aa` }}>
                {grade}
              </span>
            </div>
            <div className="mt-3 font-display text-xl uppercase" style={{ color }}>
              {GRADE_WORD[grade]}
            </div>
            <div className="mt-3 font-label text-xs font-semibold uppercase tracking-[0.25em] text-dim">Score</div>
            <div className="font-display text-5xl leading-none text-ink tabular">{shownScore}</div>
          </div>
          <div className="tal-slab px-4 py-3">
            <div className="flex items-baseline justify-between">
              <span className="font-display text-lg uppercase text-ink">Level {after.level}</span>
              <span className="font-display text-lg text-accent tabular">+{shownXp} XP</span>
            </div>
            <div className="mt-2 h-3 overflow-hidden border border-white/10 bg-black/50">
              <div className="h-full bg-[linear-gradient(90deg,#d9861a,#ffd56a)] transition-[width] duration-[1200ms] ease-out" style={{ width: `${Math.round(fill * 100)}%` }} />
            </div>
            <div className="mt-1 flex justify-between text-xs text-dim">
              <span>{levelledUp ? <span className="font-semibold text-accent">Level up!</span> : `${after.need - after.into} XP to level ${after.level + 1}`}</span>
              <span className="tabular">
                {after.into} / {after.need}
              </span>
            </div>
          </div>
        </div>

        {/* the numbers, the medals, and the full stats on request */}
        <div className="flex min-h-0 flex-col gap-3">
          {details ? (
            <div className="min-h-0 flex-1 overflow-hidden">
              <SessionReportBody s={s} />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                {s.mode === 'spray' ? (
                  <>
                    <BigStat label="Avg spray" value={s.spray ? Math.round(s.spray.avgScore) : '—'} sub="0 no control · 100 perfect" icon={Gauge} accent />
                    <BigStat label="Best spray" value={s.spray ? s.spray.bestScore : '—'} sub={`${s.spray?.sprays ?? 0} sprays`} icon={Trophy} />
                    <BigStat label="Tight bullets" value={s.spray ? `${Math.round(s.spray.avgTightPct)}%` : '—'} sub="inside a head at 15 m" icon={Target} />
                    <BigStat label="Avg error" value={s.spray ? `${s.spray.avgErrorDeg.toFixed(2)}°` : '—'} sub="from the first shot" icon={Crosshair} />
                  </>
                ) : (
                  <>
                    <BigStat label="Kills / deaths" value={`${s.kills} / ${s.deaths}`} sub={`K/D ${kd}`} icon={Skull} accent />
                    <BigStat label="Accuracy" value={`${accuracy(s)}%`} sub={`${s.hits} of ${s.shots} shots hit`} icon={Target} />
                    <BigStat label="Headshots" value={`${hsPct(s)}%`} sub={`${s.headshots} to the head`} icon={Crosshair} />
                    {s.clear ? (
                      <BigStat label={s.mode === 'retake' ? 'Defused' : 'Rounds won'} value={`${s.clear.cleared} / ${s.clear.rounds}`} sub="rounds" icon={Trophy} />
                    ) : (
                      <BigStat label="Damage" value={s.damageDealt} sub={`taken ${s.damageTaken}`} icon={Flame} />
                    )}
                  </>
                )}
              </div>

              <div className="tal-slab min-h-0 flex-1 px-4 py-3">
                <div className="mb-2 flex items-center gap-2 font-display text-sm uppercase text-accent">
                  <Medal size={16} /> Medals · {won.length} / {medals.length}
                </div>
                {won.length > 0 ? (
                  <div className="grid grid-cols-3 gap-2">
                    {won.map((m, i) => (
                      <div key={m.id} className="tal-medal flex items-center gap-2 border border-accent/40 bg-accent/10 px-2.5 py-2" style={{ animationDelay: `${300 + i * 140}ms` }}>
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[radial-gradient(circle,#ffd56a,#c9781a)] text-[#1c1203] shadow-[0_0_14px_rgba(245,165,36,0.6)]">
                          <m.icon size={18} />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-display text-sm uppercase text-ink">{m.name}</span>
                          <span className="block truncate text-xs text-mute">{m.how}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-mute">No medals this time.</p>
                )}
                {next && (
                  <div className="mt-3 flex items-center gap-2 text-sm text-dim">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/15 text-mute">
                      <next.icon size={14} />
                    </span>
                    Next to win: <span className="font-semibold text-mute">{next.name}</span> · {next.how}
                  </div>
                )}
              </div>
            </>
          )}

          <div className="flex shrink-0 items-center gap-2">
            {actions}
            <span className="flex-1" />
            <button type="button" onClick={() => setDetails((d) => !d)} className="tal-slab px-4 py-2.5 font-display text-sm uppercase">
              {details ? '◀ Debrief' : 'Full stats'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
