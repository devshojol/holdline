import { Copy, RotateCcw, Save, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import type { CrosshairLineSettings, CrosshairSettings } from '../types';
import { store, useAppStore } from '../hooks/useAppStore';
import { Button, Card, Cycler, PageHeader, Slider, Toggle, cx } from '../components/ui';
import { CrosshairPreview } from '../components/CrosshairPreview';
import { CROSSHAIR_COLORS, DEFAULT_CROSSHAIR } from '../settings/defaults';
import { exportCrosshairCode, importCrosshairCode } from '../game/hud/crosshairRenderer';

function LineEditor({ l, onChange }: { l: CrosshairLineSettings; onChange: (l: CrosshairLineSettings) => void }) {
  const set = (p: Partial<CrosshairLineSettings>) => onChange({ ...l, ...p });
  return (
    <div>
      <Toggle label="Show these lines" checked={l.show} onChange={(v) => set({ show: v })} />
      <div className={cx('grid grid-cols-2 gap-x-5', !l.show && 'pointer-events-none opacity-40')}>
        <Slider label="Opacity" value={l.opacity} min={0} max={1} step={0.01} onChange={(v) => set({ opacity: v })} />
        <Slider label="Length" value={l.length} min={0} max={20} step={1} onChange={(v) => set({ length: v })} />
        <Slider label="Thickness" value={l.thickness} min={0} max={10} step={1} onChange={(v) => set({ thickness: v })} />
        <Slider label="Gap" value={l.offset} min={0} max={40} step={1} onChange={(v) => set({ offset: v })} />
        <Toggle label="Spread when moving" checked={l.movementError} onChange={(v) => set({ movementError: v })} />
        <Slider label="Moving amount" value={l.movementMult} min={0} max={3} step={0.1} onChange={(v) => set({ movementMult: v })} />
        <Toggle label="Spread when firing" checked={l.firingError} onChange={(v) => set({ firingError: v })} />
        <Slider label="Firing amount" value={l.firingMult} min={0} max={3} step={0.1} onChange={(v) => set({ firingMult: v })} />
      </div>
    </div>
  );
}

export function CrosshairPage() {
  const ch = useAppStore((s) => s.settings.crosshair);
  const presets = useAppStore((s) => s.presets);
  const [bg, setBg] = useState<'scene' | 'dark' | 'light'>('scene');
  const [sim, setSim] = useState<'still' | 'moving' | 'firing'>('still');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [presetName, setPresetName] = useState('');
  const [edit, setEdit] = useState<'main' | 'inner' | 'outer'>('main');
  const [keep, setKeep] = useState<'saved' | 'share'>('saved');

  const set = (p: Partial<CrosshairSettings>) => store.updateSettings((s) => ({ ...s, crosshair: { ...s.crosshair, ...p } }));
  const replace = (c: CrosshairSettings) => store.updateSettings((s) => ({ ...s, crosshair: c }));
  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 2500);
  };
  const isCustom = !CROSSHAIR_COLORS.some((c) => c.hex.toLowerCase() === ch.color.toLowerCase());

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader kicker="Your aim point" title="Crosshair">
        <Button variant="outline" size="sm" onClick={() => replace(DEFAULT_CROSSHAIR)}>
          <RotateCcw size={14} /> Default
        </Button>
      </PageHeader>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
        {/* the editor */}
        <Card className="flex min-h-0 flex-col !p-3">
          <div className="mb-3 grid grid-cols-3 gap-1">
            {(['main', 'inner', 'outer'] as const).map((t) => (
              <button key={t} type="button" aria-current={edit === t ? 'page' : undefined} onClick={() => setEdit(t)} className="tal-slab py-2 font-display text-sm uppercase">
                {t === 'main' ? 'Colour & dot' : t === 'inner' ? 'Inner lines' : 'Outer lines'}
              </button>
            ))}
          </div>
          {edit === 'main' && (
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {CROSSHAIR_COLORS.map((c) => (
                  <button
                    key={c.hex}
                    title={c.name}
                    onClick={() => set({ color: c.hex })}
                    className={cx('h-8 w-8 border-2', ch.color.toLowerCase() === c.hex ? 'border-white' : 'border-transparent')}
                    style={{ background: c.hex }}
                  />
                ))}
                <label className={cx('flex items-center gap-2 border px-2 py-1 text-sm', isCustom ? 'border-white' : 'border-line')}>
                  Custom
                  <input type="color" value={ch.color} onChange={(e) => set({ color: e.target.value })} className="h-6 w-8 cursor-pointer border-0 bg-transparent" />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-x-5">
                <div>
                  <Toggle label="Outlines" checked={ch.outlines} onChange={(v) => set({ outlines: v })} />
                  <Slider label="Outline opacity" value={ch.outlineOpacity} min={0} max={1} step={0.01} onChange={(v) => set({ outlineOpacity: v })} />
                  <Slider label="Outline thickness" value={ch.outlineThickness} min={1} max={6} step={1} onChange={(v) => set({ outlineThickness: v })} />
                </div>
                <div>
                  <Toggle label="Centre dot" checked={ch.centerDot} onChange={(v) => set({ centerDot: v })} />
                  <Slider label="Dot opacity" value={ch.centerDotOpacity} min={0} max={1} step={0.01} onChange={(v) => set({ centerDotOpacity: v })} />
                  <Slider label="Dot size" value={ch.centerDotThickness} min={1} max={6} step={1} onChange={(v) => set({ centerDotThickness: v })} />
                </div>
              </div>
              <Toggle label="Dynamic" hint="Off: the lines never move, whatever the line settings say" checked={ch.dynamic} onChange={(v) => set({ dynamic: v })} />
            </div>
          )}
          {edit === 'inner' && <LineEditor l={ch.inner} onChange={(inner) => set({ inner })} />}
          {edit === 'outer' && <LineEditor l={ch.outer} onChange={(outer) => set({ outer })} />}
        </Card>

        {/* how it looks, and saved styles */}
        <div className="flex min-h-0 flex-col gap-3">
          <Card className="!p-3">
            <CrosshairPreview settings={ch} background={bg} className="aspect-[16/7] w-full border border-line" movementPx={sim === 'moving' ? 14 : 0} firingPx={sim === 'firing' ? 10 : 0} />
            <div className="mt-2 flex items-center gap-3">
              <CrosshairPreview settings={ch} background={bg} className="h-16 w-40 shrink-0 border border-line" zoom={4} />
              <div className="min-w-0 flex-1 space-y-0">
                <Cycler label="Background" value={bg} onChange={setBg} options={[{ value: 'scene', label: 'Street' }, { value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]} />
                <Cycler label="Show it" value={sim} onChange={setSim} options={[{ value: 'still', label: 'Still' }, { value: 'moving', label: 'Moving' }, { value: 'firing', label: 'Firing' }]} />
              </div>
            </div>
          </Card>
          <Card className="flex min-h-0 flex-1 flex-col !p-3">
            <div className="mb-2 grid grid-cols-2 gap-1">
              {(['saved', 'share'] as const).map((t) => (
                <button key={t} type="button" aria-current={keep === t ? 'page' : undefined} onClick={() => setKeep(t)} className="tal-slab py-2 font-display text-sm uppercase">
                  {t === 'saved' ? 'Saved' : 'Share'}
                </button>
              ))}
            </div>
            {keep === 'saved' && (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex gap-2">
                  <input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Name this crosshair" className="min-w-0 flex-1 border border-line bg-bg px-3 py-1.5 text-sm outline-none focus:border-accent" />
                  <Button
                    size="sm"
                    onClick={() => {
                      const name = presetName.trim() || `Crosshair ${presets.length + 1}`;
                      store.savePresets([...presets, { id: Date.now().toString(36), name, settings: ch }]);
                      setPresetName('');
                      flash(`Saved “${name}”`);
                    }}
                  >
                    <Save size={14} /> Save
                  </Button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  {presets.length === 0 && <div className="col-span-2 text-sm text-dim">Nothing saved yet.</div>}
                  {presets.slice(0, 6).map((p) => (
                    <div key={p.id} className="flex items-center gap-2 border border-line px-1.5 py-1">
                      <CrosshairPreview settings={p.settings} background="dark" className="h-8 w-8 shrink-0" />
                      <button type="button" className="min-w-0 flex-1 truncate text-left text-sm hover:text-accent" onClick={() => replace(p.settings)} title="Use this crosshair">
                        {p.name}
                      </button>
                      <button className="p-1 text-dim hover:text-accent" title="Delete" onClick={() => store.savePresets(presets.filter((x) => x.id !== p.id))}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {keep === 'share' && (
              <div>
                <textarea value={code} onChange={(e) => setCode(e.target.value)} placeholder="Paste a crosshair code" className="h-16 w-full resize-none border border-line bg-bg p-2 font-mono text-xs outline-none focus:border-accent" />
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const c = exportCrosshairCode(ch);
                      setCode(c);
                      navigator.clipboard?.writeText(c).then(
                        () => flash('Code copied'),
                        () => flash('The code is in the box'),
                      );
                    }}
                  >
                    <Copy size={14} /> Copy code
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const parsed = importCrosshairCode(code);
                      if (parsed) {
                        replace({ ...DEFAULT_CROSSHAIR, ...parsed, inner: { ...DEFAULT_CROSSHAIR.inner, ...parsed.inner }, outer: { ...DEFAULT_CROSSHAIR.outer, ...parsed.outer } });
                        flash('Crosshair loaded');
                      } else flash("That code can't be read");
                    }}
                  >
                    <Upload size={14} /> Load code
                  </Button>
                </div>
              </div>
            )}
            {msg && <div className="mt-2 text-xs text-ok">{msg}</div>}
          </Card>
        </div>
      </div>
    </div>
  );
}
