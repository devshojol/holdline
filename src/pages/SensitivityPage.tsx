import { MousePointer2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { SensitivitySettings } from '../types';
import { store, useAppStore } from '../hooks/useAppStore';
import { Button, Card, Cycler, PageHeader, Slider, Stat, Toggle } from '../components/ui';
import { YAW_DEG_PER_COUNT, cmPer360, edpi } from '../settings/defaults';

const GAMES: { name: string; yaw: number }[] = [
  { name: 'Same scale (0.07°)', yaw: 0.07 },
  { name: 'CS2 / Apex', yaw: 0.022 },
  { name: 'Overwatch 2', yaw: 0.0066 },
  { name: 'Fortnite', yaw: 0.5555 },
];

function TurnTest({ s }: { s: SensitivitySettings }) {
  const ref = useRef<HTMLDivElement>(null);
  const [locked, setLocked] = useState(false);
  const [deg, setDeg] = useState(0);
  const counts = useRef(0);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== ref.current) return;
      counts.current += e.movementX;
      setDeg(counts.current * s.sensitivity * YAW_DEG_PER_COUNT * s.horizontalMult);
    };
    const onLock = () => setLocked(document.pointerLockElement === ref.current);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('pointerlockchange', onLock);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('pointerlockchange', onLock);
    };
  }, [s.sensitivity, s.horizontalMult]);
  return (
    <div>
      <div
        ref={ref}
        onClick={() => {
          counts.current = 0;
          setDeg(0);
          const el = ref.current as HTMLDivElement & { requestPointerLock(o?: unknown): Promise<void> | void };
          try {
            const r = el.requestPointerLock(s.rawInput ? { unadjustedMovement: true } : undefined);
            if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => el.requestPointerLock());
          } catch {
            el.requestPointerLock();
          }
        }}
        className="relative grid h-60 cursor-crosshair place-items-center overflow-hidden border border-line bg-bg"
      >
        <div className="absolute inset-x-0 top-3 text-center text-xs uppercase tracking-widest text-dim">
          {locked ? 'Move your mouse — Esc to release' : 'Click to capture the mouse'}
        </div>
        <svg viewBox="-100 -100 200 200" className="h-40 w-40">
          <circle r="90" fill="none" stroke="#222e3c" strokeWidth="2" />
          {[0, 90, 180, 270].map((a) => (
            <text key={a} x={Math.sin((a * Math.PI) / 180) * 74} y={-Math.cos((a * Math.PI) / 180) * 74} fill="#5b6776" fontSize="12" textAnchor="middle" dominantBaseline="middle">
              {a}°
            </text>
          ))}
          <g transform={`rotate(${deg})`}>
            <line x1="0" y1="0" x2="0" y2="-80" stroke="#f5a524" strokeWidth="4" />
            <circle r="6" fill="#f5a524" />
          </g>
        </svg>
        <div className="absolute bottom-3 font-display text-2xl font-bold tabular">
          {deg.toFixed(1)}° · {(deg / 360).toFixed(2)} turns
        </div>
      </div>
      <p className="mt-2 text-xs text-dim">Swipe your usual 360° distance: the dial turns exactly as the game camera does.</p>
    </div>
  );
}

export function SensitivityPage() {
  const s = useAppStore((st) => st.settings.sensitivity);
  const set = (p: Partial<SensitivitySettings>) => store.updateSettings((x) => ({ ...x, sensitivity: { ...x.sensitivity, ...p } }));
  const [src, setSrc] = useState(GAMES[1]);
  const [srcSens, setSrcSens] = useState(1.5);
  const converted = (srcSens * src.yaw) / YAW_DEG_PER_COUNT;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader kicker="Aim feel" title="Sensitivity">
        <span className="inline-flex items-center gap-2 text-xs text-dim">
          <MousePointer2 size={14} /> Changes apply at once, even mid-match
        </span>
      </PageHeader>
      <div className="grid min-h-0 flex-1 grid-cols-3 gap-4">
        <Card className="!p-4">
          <div className="mb-1 font-display text-sm uppercase text-accent">Mouse</div>
          <Slider label="Sensitivity" value={s.sensitivity} min={0.01} max={5} step={0.001} onChange={(v) => set({ sensitivity: v })} />
          <Slider label="Mouse DPI" value={s.dpi} min={100} max={6400} step={50} onChange={(v) => set({ dpi: Math.round(v) })} />
          <div className="grid grid-cols-2 gap-x-4">
            <Slider label="Horizontal" value={s.horizontalMult} min={0.1} max={3} step={0.01} onChange={(v) => set({ horizontalMult: v })} />
            <Slider label="Vertical" value={s.verticalMult} min={0.1} max={3} step={0.01} onChange={(v) => set({ verticalMult: v })} />
            <Slider label="Aiming" value={s.adsMult} min={0.1} max={3} step={0.01} onChange={(v) => set({ adsMult: v })} />
            <Slider label="Scoped" value={s.scopedMult} min={0.1} max={3} step={0.01} onChange={(v) => set({ scopedMult: v })} />
          </div>
          <Toggle label="Invert look" checked={s.invertY} onChange={(v) => set({ invertY: v })} />
          <Toggle label="Raw input" hint="Skips system mouse acceleration (Chrome, Edge)" checked={s.rawInput} onChange={(v) => set({ rawInput: v })} />
        </Card>
        <div className="flex min-h-0 flex-col gap-3">
          <Card className="!p-3">
            <TurnTest s={s} />
          </Card>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="eDPI" value={Math.round(edpi(s.dpi, s.sensitivity))} sub="DPI × sensitivity" accent />
            <Stat label="cm / 360°" value={cmPer360(s.dpi, s.sensitivity).toFixed(1)} sub={`${(cmPer360(s.dpi, s.sensitivity) / 2.54).toFixed(1)} in`} />
          </div>
        </div>
        <div className="flex min-h-0 flex-col gap-3">
          <Card className="!p-4">
            <div className="mb-2 font-display text-sm uppercase text-accent">Bring yours from another game</div>
            <Cycler label="Game" value={src.name} onChange={(v) => setSrc(GAMES.find((g) => g.name === v) ?? GAMES[0])} options={GAMES.map((g) => ({ value: g.name, label: g.name }))} />
            <label className="mt-2 flex items-center justify-between gap-3 text-sm">
              <span className="text-mute">Its sensitivity</span>
              <input type="number" step="0.001" value={srcSens} onChange={(e) => setSrcSens(parseFloat(e.target.value) || 0)} className="w-28 border border-line bg-bg px-2 py-1.5 text-right text-ink outline-none focus:border-accent" />
            </label>
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-sm">
                = <span className="font-display text-2xl tabular text-accent">{converted.toFixed(3)}</span> here
              </span>
              <Button size="sm" onClick={() => set({ sensitivity: Math.round(converted * 1000) / 1000 })}>
                Use this
              </Button>
            </div>
          </Card>
          <Card className="!p-4">
            <div className="mb-2 font-display text-sm uppercase text-accent">Quick picks</div>
            <div className="grid grid-cols-2 gap-2">
              {[
                ['Slow · 400 DPI', 400, 0.6],
                ['Typical · 800', 800, 0.35],
                ['Slow · 1600', 1600, 0.18],
                ['Fast · 800', 800, 0.6],
              ].map(([name, dpi, sens]) => (
                <Button key={name as string} variant="outline" size="sm" onClick={() => set({ dpi: dpi as number, sensitivity: sens as number })}>
                  {name as string}
                </Button>
              ))}
            </div>
            <p className="mt-3 text-xs text-dim">Most good players sit around 200–400 eDPI (30–60 cm for a full turn).</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
