import { Check, Database, Download, Keyboard, LayoutDashboard, Monitor, MousePointer2, RotateCcw, Upload, User, Volume2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AudioSettings, GraphicsPreset, GraphicsSettings, HudSettings } from '../types';
import { store, useAppStore } from '../hooks/useAppStore';
import { Button, Card, ConfirmButton, Cycler, PageHeader, Segmented, Slider, Toggle, cx } from '../components/ui';
import { DEFAULT_SETTINGS, GRAPHICS_PRESETS } from '../settings/defaults';
import { mergeDefaults } from '../services/storage';
import { detectDevice } from '../settings/deviceProfile';
import { AgentPortrait } from '../components/AgentPicker';
import { getAgent } from '../game/agents';
import { multiplayer, useMultiplayer } from '../multiplayer/client';
import { MAX_NAME_LENGTH, sanitizeName } from '../net/protocol';
import { BIND_GROUPS, DEFAULT_KEYS, RESERVED_KEYS, bindKey, keyLabel, type BindAction } from '../settings/keybindings';

type Section = 'profile' | 'controls' | 'graphics' | 'audio' | 'hud' | 'data';
const SECTIONS: { id: Section; label: string; blurb: string; icon: typeof Monitor }[] = [
  { id: 'controls', label: 'Controls', blurb: 'Keys, mouse buttons, sensitivity', icon: Keyboard },
  { id: 'graphics', label: 'Graphics', blurb: 'Quality, frame rate, models', icon: Monitor },
  { id: 'audio', label: 'Audio', blurb: 'Volume of each kind of sound', icon: Volume2 },
  { id: 'hud', label: 'HUD', blurb: 'What shows while you play', icon: LayoutDashboard },
  { id: 'profile', label: 'Profile', blurb: 'The name other players see', icon: User },
  { id: 'data', label: 'Data', blurb: 'Back up, restore or reset', icon: Database },
];

/** The category shown when the screen opens: the last one looked at, or one another screen asked for. */
let lastSection: Section = 'controls';
export function showSettingsSection(section: Section) {
  lastSection = section;
}

/** A titled block inside a section, with a rule above it. */
function Group({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center justify-between gap-3 border-b border-white/[0.07] pb-1">
        <h3 className="font-display text-sm uppercase text-accent">{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}

/** The title of an open section, what it is for, and a way to put just this section back to its defaults. */
function SectionHead({ title, blurb, onReset }: { title: string; blurb: string; onReset?: () => void }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="font-display text-xl uppercase text-ink">{title}</h2>
        <p className="text-sm text-mute">{blurb}</p>
      </div>
      {onReset && (
        <ConfirmButton confirmLabel="Reset this section?" onConfirm={onReset}>
          <RotateCcw size={14} /> Defaults
        </ConfirmButton>
      )}
    </div>
  );
}

export function SettingsPage() {
  const [section, setSectionState] = useState<Section>(lastSection);
  const setSection = (sec: Section) => {
    lastSection = sec;
    setSectionState(sec);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader kicker="Options" title="Settings">
        <span className="inline-flex items-center gap-1.5 text-xs uppercase tracking-widest text-dim">
          <Check size={14} className="text-ok" /> Changes save as you make them
        </span>
      </PageHeader>
      <div className="grid min-h-0 flex-1 grid-cols-[230px_minmax(0,1fr)] gap-4">
        {/* the categories, as a game's options menu: one shows at a time */}
        <nav aria-label="Settings categories" className="tal-rail">
          {SECTIONS.map((sec) => (
            <button key={sec.id} type="button" aria-current={sec.id === section ? 'page' : undefined} className="tal-rail-item" onClick={() => setSection(sec.id)}>
              <sec.icon size={18} className="shrink-0" />
              <span className="min-w-0 text-left">
                <span className="block">{sec.label}</span>
                <span className="hidden truncate text-xs normal-case tracking-normal text-dim lg:block">{sec.blurb}</span>
              </span>
            </button>
          ))}
        </nav>
        <div key={section} className="tal-rise flex min-h-0 min-w-0 flex-col [&>section]:min-h-0 [&>section]:flex-1">
          {section === 'controls' && <ControlsCard />}
          {section === 'graphics' && <GraphicsCard />}
          {section === 'audio' && <AudioCard />}
          {section === 'hud' && <HudCard />}
          {section === 'profile' && <ProfileCard />}
          {section === 'data' && <DataCard />}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Controls                                                            */
/* ------------------------------------------------------------------ */

/**
 * Every action with two key slots. Click a slot and press a key or mouse button to bind it; Esc cancels,
 * Backspace or Delete empties the slot. A key already used elsewhere moves here, and the screen says so.
 */
function ControlsCard() {
  const keys = useAppStore((s) => s.settings.keys);
  const sens = useAppStore((s) => s.settings.sensitivity);
  const [listening, setListening] = useState<{ action: BindAction; slot: 0 | 1; keyboardOnly: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const labelOf = (action: BindAction) => BIND_GROUPS.flatMap((g) => g.rows).find((r) => r.action === action)?.label ?? action;

  const assign = (action: BindAction, slot: 0 | 1, code: string) => {
    const { keys: next, movedFrom } = bindKey(store.get().settings.keys, action, slot, code);
    store.updateSettings((s) => ({ ...s, keys: next }));
    if (!code) setNotice(`${labelOf(action)}: slot cleared.`);
    else if (movedFrom) setNotice(`${keyLabel(code)} moved from ${labelOf(movedFrom)} to ${labelOf(action)}.`);
    else setNotice(`${labelOf(action)} is now ${keyLabel(code)}.`);
  };

  useEffect(() => {
    if (!listening) return;
    const { action, slot, keyboardOnly } = listening;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') return setListening(null);
      if (e.code === 'Backspace' || e.code === 'Delete') {
        assign(action, slot, '');
        return setListening(null);
      }
      if (!e.code || RESERVED_KEYS.has(e.code)) return;
      assign(action, slot, e.code);
      setListening(null);
    };
    const onMouse = (e: MouseEvent) => {
      if (keyboardOnly) return;
      e.preventDefault();
      e.stopPropagation();
      assign(action, slot, `Mouse${e.button}`);
      setListening(null);
    };
    const noMenu = (e: Event) => e.preventDefault();
    // attach after the click that opened the slot has finished, so that click isn't taken as the binding
    const t = setTimeout(() => {
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('mousedown', onMouse, true);
      window.addEventListener('contextmenu', noMenu, true);
    }, 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
      window.removeEventListener('contextmenu', noMenu, true);
    };
  }, [listening]);

  const setS = (p: Partial<typeof sens>) => store.updateSettings((s) => ({ ...s, sensitivity: { ...s.sensitivity, ...p } }));

  return (
    <Card>
      <SectionHead
        title="Controls"
        blurb="Every key and mouse button can be changed."
        onReset={() => {
          store.updateSettings((s) => ({ ...s, keys: DEFAULT_KEYS }));
          setNotice('All keys are back to their defaults.');
        }}
      />
      <div aria-live="polite" className={cx('mb-3 flex min-h-9 items-center gap-2 border px-3 py-1.5 text-sm', listening ? 'border-accent/60 bg-accent/10 text-ink' : notice ? 'border-ok/30 bg-ok/5 text-ok' : 'border-white/10 text-dim')}>
        <MousePointer2 size={15} className="shrink-0" />
        {listening
          ? `Press a ${listening.keyboardOnly ? 'key' : 'key or mouse button'} for ${labelOf(listening.action)} · Esc cancels · Backspace clears`
          : (notice ?? 'Click a key, then press the new one. Each action can have two. Esc is kept for pausing.')}
      </div>
      <div className="grid grid-cols-3 gap-5">
        {[[BIND_GROUPS[0]], [BIND_GROUPS[1], BIND_GROUPS[2]], [BIND_GROUPS[3]]].map((column, ci) => (
          <div key={ci} className="space-y-4">
            {column.map((group) => (
              <Group key={group.title} title={group.title}>
                {group.rows.map((row) => (
                  <div key={row.action} className="grid grid-cols-[minmax(0,1fr)_4.6rem_4.6rem] items-center gap-1.5 py-[3px]" title={row.hint}>
                    <div className="truncate text-sm text-ink">{row.label}</div>
                    {([0, 1] as const).map((slot) => {
                      const code = keys[row.action][slot];
                      const active = listening?.action === row.action && listening.slot === slot;
                      return (
                        <button
                          key={slot}
                          type="button"
                          aria-label={`${row.label}, ${slot === 0 ? 'key' : 'second key'}: ${code ? keyLabel(code) : 'none'}`}
                          onClick={() => setListening(active ? null : { action: row.action, slot, keyboardOnly: !!row.keyboardOnly })}
                          className={cx(
                            'h-8 truncate border px-1 font-display text-xs uppercase transition-colors',
                            active
                              ? 'animate-pulse border-accent bg-accent/20 text-ink'
                              : code
                                ? 'border-line bg-bg text-ink hover:border-accent'
                                : 'border-dashed border-line bg-transparent text-dim hover:border-mute hover:text-mute',
                          )}
                        >
                          {active ? 'Press…' : code ? keyLabel(code) : '+'}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </Group>
            ))}
            {ci === 2 && (
              <Group
                title="Mouse"
                right={
                  <button type="button" className="text-xs uppercase text-mute hover:text-ink" onClick={() => store.go('sensitivity')}>
                    More ▶
                  </button>
                }
              >
                <Slider label="Sensitivity" value={sens.sensitivity} min={0.01} max={5} step={0.01} onChange={(v) => setS({ sensitivity: v })} format={(v) => `eDPI ${Math.round(v * sens.dpi)}`} />
                <Toggle label="Invert look" checked={sens.invertY} onChange={(v) => setS({ invertY: v })} />
              </Group>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Graphics                                                            */
/* ------------------------------------------------------------------ */

function GraphicsCard() {
  const g = useAppStore((s) => s.settings.graphics);
  const device = useMemo(detectDevice, []);
  const setG = (p: Partial<GraphicsSettings>) => store.updateSettings((s) => ({ ...s, graphics: { ...s.graphics, ...p, preset: p.preset ?? 'custom' } }));
  const preset = (p: GraphicsPreset) => {
    if (p === 'custom') return setG({ preset: 'custom' });
    store.updateSettings((s) => ({ ...s, graphics: { ...s.graphics, ...GRAPHICS_PRESETS[p], preset: p } }));
  };
  const suggested = device.preset[0].toUpperCase() + device.preset.slice(1);
  const next = ' (from the next match)';

  return (
    <Card>
      <SectionHead
        title="Graphics"
        blurb="Pick a preset, then fine-tune. Lower settings run smoother on slower computers."
        onReset={() => store.updateSettings((s) => ({ ...s, graphics: DEFAULT_SETTINGS.graphics }))}
      />
      <div className="mb-3 flex flex-wrap items-center gap-3 border border-white/10 bg-black/20 px-3 py-2">
        <span className="font-display text-sm uppercase text-accent">Preset</span>
        <Segmented
          value={g.preset}
          onChange={preset}
          options={[
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
            { value: 'custom', label: 'Custom' },
          ]}
        />
        <span className="text-xs text-dim">
          Best here:{' '}
          <button type="button" className="text-accent underline" onClick={() => preset(device.preset)}>
            {suggested}
          </button>
        </span>
      </div>
      <div className="grid grid-cols-3 gap-x-6 gap-y-4">
        <Group title="Display">
          <Slider label="Resolution" value={g.resolutionScale} min={0.5} max={1} step={0.05} onChange={(v) => setG({ resolutionScale: v })} format={(v) => `${Math.round(v * 100)}% of your screen`} />
          <Cycler
            label="Frame rate limit"
            value={g.fpsCap}
            onChange={(v) => setG({ fpsCap: v, preset: g.preset })}
            options={[
              { value: 0, label: 'Unlimited' },
              { value: 30, label: '30' },
              { value: 60, label: '60' },
              { value: 120, label: '120' },
              { value: 144, label: '144' },
            ]}
          />
          <Toggle label="Adaptive resolution" hint="Drops the resolution while the frame rate is low" checked={g.adaptiveResolution} onChange={(v) => setG({ adaptiveResolution: v, preset: g.preset })} />
          {/* on CrazyGames the site's own fullscreen button is the only one allowed */}
          {!__CRAZYGAMES__ && <Toggle label="Fullscreen on start" checked={g.fullscreen} onChange={(v) => setG({ fullscreen: v, preset: g.preset })} />}
        </Group>
        <Group title="Detail">
          <Cycler label="Shadows" hint={`Sun shadows${next}`} value={g.shadows} onChange={(v) => setG({ shadows: v })} options={[{ value: 'off', label: 'Off' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }]} />
          <Cycler label="Effects" hint={`Bullet holes, sparks, muzzle light${next}`} value={g.effects} onChange={(v) => setG({ effects: v })} options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }]} />
          <Cycler label="Lighting" hint={`Lighting${next}`} value={g.lighting} onChange={(v) => setG({ lighting: v })} options={[{ value: 'simple', label: 'Simple' }, { value: 'full', label: 'Full' }]} />
          <Cycler label="Textures" hint={`Texture detail${next}`} value={g.textureQuality} onChange={(v) => setG({ textureQuality: v })} options={[{ value: 'low', label: 'Low' }, { value: 'high', label: 'High' }]} />
          <Toggle label="Smooth edges" hint="Anti-aliasing (FXAA)" checked={g.antialias} onChange={(v) => setG({ antialias: v })} />
          <Toggle label="Colour grading" hint="Tone mapping, contrast, vignette" checked={g.postFx} onChange={(v) => setG({ postFx: v })} />
        </Group>
        <Group title="Models">
          <Cycler
            label="Your arms"
            hint="Your first-person arms (from the next match)"
            value={g.fpArms === 'simple' ? 'animated' : g.fpArms}
            onChange={(v) => setG({ fpArms: v })}
            options={[{ value: 'animated' as const, label: 'Animated' }, { value: 'rigged' as const, label: 'Posed' }]}
          />
          <p className="py-1 text-xs text-dim">Soldiers, guns and hands always use their full models: Low only makes the scene cheaper to draw.</p>
          <div className="h-3" />
          <Cycler label="Renderer" hint={`WebGPU falls back to WebGL 2 where unsupported${next}`} value={g.renderer} onChange={(v) => setG({ renderer: v, preset: g.preset })} options={[{ value: 'webgl2', label: 'WebGL 2' }, { value: 'webgpu', label: 'WebGPU (beta)' }]} />
          <p className="mt-1 text-xs text-dim">Shadows, effects, lighting, textures and models change from the next match.</p>
        </Group>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Audio and HUD                                                       */
/* ------------------------------------------------------------------ */

function AudioCard() {
  const a = useAppStore((s) => s.settings.audio);
  const setA = (p: Partial<AudioSettings>) => store.updateSettings((s) => ({ ...s, audio: { ...s.audio, ...p } }));
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <Card>
      <SectionHead
        title="Audio"
        blurb="Footsteps tell you where enemies are: keep them loud enough to hear."
        onReset={() => store.updateSettings((s) => ({ ...s, audio: DEFAULT_SETTINGS.audio }))}
      />
      <div>
        <Slider label="Master volume" value={a.master} min={0} max={1} step={0.01} onChange={(v) => setA({ master: v })} format={pct} />
        <Slider label="Guns" value={a.weapons} min={0} max={1} step={0.01} onChange={(v) => setA({ weapons: v })} format={pct} />
        <Slider label="Footsteps" value={a.footsteps} min={0} max={1} step={0.01} onChange={(v) => setA({ footsteps: v })} format={pct} />
        <Slider label="Effects and feedback" value={a.effects} min={0} max={1} step={0.01} onChange={(v) => setA({ effects: v })} format={pct} />
      </div>
      <Toggle label="Hit and headshot sounds" checked={a.hitSounds} onChange={(v) => setA({ hitSounds: v })} />
      <p className="mt-2 text-xs text-dim">Enemy shots and footsteps come from where they happen and are muffled behind walls: headphones help.</p>
    </Card>
  );
}

function HudCard() {
  const h = useAppStore((s) => s.settings.hud);
  const setH = (p: Partial<HudSettings>) => store.updateSettings((s) => ({ ...s, hud: { ...s.hud, ...p } }));
  return (
    <Card>
      <SectionHead
        title="HUD"
        blurb="Show only what helps you: a quieter screen makes enemies easier to spot."
        onReset={() => store.updateSettings((s) => ({ ...s, hud: DEFAULT_SETTINGS.hud }))}
      />
      <div className="grid grid-cols-2 gap-x-8 gap-y-4">
        <Group title="Information">
          <div>
            <Toggle label="Health and shield" checked={h.showHealth} onChange={(v) => setH({ showHealth: v })} />
            <Toggle label="Weapon and ammo" checked={h.showAmmo} onChange={(v) => setH({ showAmmo: v })} />
            <Toggle label="Timer" checked={h.showTimer} onChange={(v) => setH({ showTimer: v })} />
            <Toggle label="Kills and deaths" checked={h.showKills} onChange={(v) => setH({ showKills: v })} />
            <Toggle label="Kill feed" checked={h.showKillFeed} onChange={(v) => setH({ showKillFeed: v })} />
          </div>
        </Group>
        <Group title="Combat feedback">
          <div>
            <Toggle label="Hit markers" checked={h.showHitmarkers} onChange={(v) => setH({ showHitmarkers: v })} />
            <Toggle label="Damage direction" checked={h.showDamageIndicator} onChange={(v) => setH({ showDamageIndicator: v })} />
            <Toggle label="Moving-shot warning" hint="Reminds you to stop before you shoot." checked={h.showMoveWarning} onChange={(v) => setH({ showMoveWarning: v })} />
          </div>
        </Group>
        <Group title="Minimap">
          <div>
            <Toggle label="Minimap" checked={h.showMinimap} onChange={(v) => setH({ showMinimap: v })} />
            <Slider
              label="Practice: show enemies within"
              value={h.minimapEnemyRange}
              min={0}
              max={60}
              step={5}
              onChange={(v) => setH({ minimapEnemyRange: v })}
              format={(v) => (v === 0 ? 'Off: none shown' : `${v} m, even through walls`)}
            />
          </div>
        </Group>
        <Group title="Performance">
          <div>
            <Toggle label="Frame rate counter" checked={h.showFps} onChange={(v) => setH({ showFps: v })} />
            <Toggle label="Detailed performance" checked={h.showPerfMetrics} onChange={(v) => setH({ showPerfMetrics: v })} />
          </div>
        </Group>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Data and profile                                                    */
/* ------------------------------------------------------------------ */

function DataCard() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [exported, setExported] = useState<string | null>(null);
  return (
    <Card>
      <SectionHead title="Data" blurb="Everything is kept in this browser. Export a file to move your setup to another computer." />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => {
            const st = store.get();
            const json = JSON.stringify({ v: 1, settings: st.settings, practice: st.practice, presets: st.presets }, null, 2);
            setExported(json);
            try {
              const blob = new Blob([json], { type: 'application/json' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = 'sunstrike-settings.json';
              a.click();
              setTimeout(() => URL.revokeObjectURL(a.href), 1000);
            } catch {
              /* downloads blocked — JSON is shown below */
            }
          }}
        >
          <Download size={16} /> Export settings
        </Button>
        <Button variant="outline" onClick={() => fileRef.current?.click()}>
          <Upload size={16} /> Import settings
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              const data = JSON.parse(await f.text());
              if (data.settings) store.updateSettings(() => mergeDefaults(DEFAULT_SETTINGS, data.settings));
              if (data.practice) store.updatePractice(data.practice);
              if (Array.isArray(data.presets)) store.savePresets(data.presets);
              setMsg('Settings imported.');
            } catch {
              setMsg('Could not read that file.');
            }
            e.target.value = '';
          }}
        />
        <ConfirmButton
          size="md"
          confirmLabel="Reset everything?"
          onConfirm={() => {
            store.updateSettings(() => DEFAULT_SETTINGS);
            setMsg('Settings reset.');
          }}
        >
          <RotateCcw size={16} /> Reset all settings
        </ConfirmButton>
      </div>
      {msg && <div className="mt-2 text-sm text-ok">{msg}</div>}
      {exported && (
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-xs text-dim">
            <span>Settings JSON (if the download was blocked, copy it from here)</span>
            <button
              className="text-mute underline hover:text-ink"
              onClick={() => {
                navigator.clipboard?.writeText(exported).then(
                  () => setMsg('Copied to clipboard.'),
                  () => setMsg('Select the text and copy it manually.'),
                );
              }}
            >
              Copy
            </button>
          </div>
          <textarea id="settings-json" readOnly value={exported} className="h-32 w-full border border-line bg-bg p-2 font-mono text-xs" />
        </div>
      )}
      <p className="mt-3 text-xs text-dim">Settings, keys, crosshair presets and your session history are stored in this browser only.</p>
    </Card>
  );
}

/** The name other players see in multiplayer. It is first chosen on the multiplayer screen; this is where it is changed. */
function ProfileCard() {
  const name = useMultiplayer((s) => s.name);
  const agent = getAgent(useMultiplayer((s) => s.agent));
  const inRoom = useMultiplayer((s) => s.room !== null);
  const [draft, setDraft] = useState(name);
  const clean = sanitizeName(draft);
  const changed = clean !== null && clean !== sanitizeName(name);
  return (
    <Card>
      <SectionHead title="Profile" blurb="Your callsign in multiplayer." />
      <form
        className="flex flex-wrap items-end gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!changed) return;
          multiplayer.setName(clean);
          setDraft(clean);
        }}
      >
        <AgentPortrait agent={agent} className="h-20 w-16 shrink-0 border border-white/10" />
        <label className="block min-w-[14rem] flex-1 sm:max-w-sm">
          <span className="mb-1.5 block text-xs uppercase tracking-widest text-dim">Callsign</span>
          <input
            className="w-full border border-line bg-bg px-3 py-2 font-display text-xl font-bold tracking-wide text-ink outline-none focus:border-accent"
            value={draft}
            maxLength={MAX_NAME_LENGTH}
            placeholder="What others see"
            aria-label="Callsign"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
        <Button type="submit" disabled={!changed}>
          Save
        </Button>
      </form>
      <p className="mt-3 text-xs text-dim">
        Your soldier ({agent.name}) is picked on the Multiplayer screen.
        {inRoom && ' A room keeps the name you joined with: the new one shows from the next room.'}
      </p>
    </Card>
  );
}
