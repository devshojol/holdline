import { Database, Download, Keyboard, LayoutDashboard, Monitor, RotateCcw, Upload, User, Volume2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { AudioSettings, GraphicsPreset, GraphicsSettings, HudSettings } from '../types';
import { store, useAppStore } from '../hooks/useAppStore';
import { Button, Card, ConfirmButton, Field, PageHeader, Segmented, Slider, Toggle } from '../components/ui';
import { DEFAULT_SETTINGS, GRAPHICS_PRESETS } from '../settings/defaults';
import { mergeDefaults } from '../services/storage';
import { detectDevice } from '../settings/deviceProfile';
import { AgentPortrait } from '../components/AgentPicker';
import { getAgent } from '../game/agents';
import { multiplayer, useMultiplayer } from '../multiplayer/client';
import { MAX_NAME_LENGTH, sanitizeName } from '../net/protocol';

type Section = 'profile' | 'graphics' | 'audio' | 'hud' | 'controls' | 'data';
const SECTIONS: { id: Section; label: string; icon: typeof Monitor }[] = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'graphics', label: 'Graphics', icon: Monitor },
  { id: 'audio', label: 'Audio', icon: Volume2 },
  { id: 'hud', label: 'HUD', icon: LayoutDashboard },
  { id: 'controls', label: 'Controls', icon: Keyboard },
  { id: 'data', label: 'Data', icon: Database },
];

/** The category shown when the screen opens: the last one looked at, or one another screen asked for. */
let lastSection: Section = 'graphics';
export function showSettingsSection(section: Section) {
  lastSection = section;
}

const KEYS: [string, string][] = [
  ['W A S D', 'Move'],
  ['Mouse', 'Aim'],
  ['Left click', 'Fire'],
  ['Right click', 'Aim down sights (rifles, Magnate) · burst (Pilot)'],
  ['R', 'Reload'],
  ['Shift (hold)', 'Walk — silent and more accurate'],
  ['Ctrl / C (hold)', 'Crouch (use C when not fullscreen — Ctrl+W closes browser tabs)'],
  ['Space', 'Jump'],
  ['1 / 2', 'Primary / sidearm'],
  ['Mouse wheel', 'Swap weapon'],
  ['B', 'Weapon menu — change primary and sidearm mid-session'],
  ['Esc', 'Pause & release mouse'],
];

export function SettingsPage() {
  const settings = useAppStore((s) => s.settings);
  const g = settings.graphics;
  const fileRef = useRef<HTMLInputElement>(null);
  const [section, setSectionState] = useState<Section>(lastSection);
  const setSection = (sec: Section) => {
    lastSection = sec;
    setSectionState(sec);
  };
  const [msg, setMsg] = useState<string | null>(null);
  const [exported, setExported] = useState<string | null>(null);
  const device = useMemo(detectDevice, []);
  const setG = (p: Partial<GraphicsSettings>) => store.updateSettings((s) => ({ ...s, graphics: { ...s.graphics, ...p, preset: p.preset ?? 'custom' } }));
  const setA = (p: Partial<AudioSettings>) => store.updateSettings((s) => ({ ...s, audio: { ...s.audio, ...p } }));
  const setH = (p: Partial<HudSettings>) => store.updateSettings((s) => ({ ...s, hud: { ...s.hud, ...p } }));
  const preset = (p: GraphicsPreset) => {
    if (p === 'custom') return setG({ preset: 'custom' });
    store.updateSettings((s) => ({ ...s, graphics: { ...s.graphics, ...GRAPHICS_PRESETS[p], preset: p } }));
  };

  return (
    <div>
      <PageHeader kicker="Options" title="Settings" />
      <div className="grid gap-6 lg:grid-cols-[230px_minmax(0,1fr)]">
        {/* the categories, as a game's options menu: one shows at a time */}
        <nav aria-label="Settings categories" className="tal-rail">
          {SECTIONS.map((sec, i) => (
            <button key={sec.id} type="button" aria-current={sec.id === section ? 'page' : undefined} className="tal-rail-item" onClick={() => setSection(sec.id)}>
              <span className="tabular w-5 text-xs text-dim">{String(i + 1).padStart(2, '0')}</span>
              <sec.icon size={17} />
              <span>{sec.label}</span>
            </button>
          ))}
        </nav>
        <div key={section} className="tal-rise min-w-0">
        {section === 'profile' && <ProfileCard />}
        {section === 'graphics' && (
        <Card title="Graphics">
          <Field label="Preset">
            <Segmented
              value={g.preset}
              onChange={preset}
              options={[
                { value: 'potato', label: 'Potato' },
                { value: 'low', label: 'Low' },
                { value: 'medium', label: 'Medium' },
                { value: 'high', label: 'High' },
                { value: 'custom', label: 'Custom' },
              ]}
            />
            <p className="mt-2 text-xs text-dim">
              Potato is for machines without a dedicated GPU: simple models, no shadows or post-processing, 60% resolution. Detected here:{' '}
              <span className="text-mute">{device.gpu || 'unknown GPU'}</span> ({device.reason}) — suggested preset{' '}
              <button className="text-accent underline" onClick={() => preset(device.preset)}>
                {device.preset[0].toUpperCase() + device.preset.slice(1)}
              </button>
              . Model, shadow, lighting and texture changes apply on the next session.
            </p>
          </Field>
          <Field label="Shadows">
            <Segmented
              value={g.shadows}
              onChange={(v) => setG({ shadows: v })}
              options={[
                { value: 'off', label: 'Off' },
                { value: 'medium', label: 'Medium (2K)' },
                { value: 'high', label: 'High (4K)' },
              ]}
            />
          </Field>
          <Field label="Effects (decals, particles, muzzle light)">
            <Segmented
              value={g.effects}
              onChange={(v) => setG({ effects: v })}
              options={[
                { value: 'low', label: 'Low' },
                { value: 'medium', label: 'Medium' },
                { value: 'high', label: 'High' },
              ]}
            />
          </Field>
          <Slider label="Resolution scale" value={g.resolutionScale} min={0.5} max={1} step={0.05} onChange={(v) => setG({ resolutionScale: v })} format={(v) => `${Math.round(v * 100)}% of native`} />
          <Toggle
            label="Adaptive resolution"
            hint="Lowers the resolution automatically while the frame rate is under 60 (or your FPS limit) and restores it afterwards."
            checked={g.adaptiveResolution}
            onChange={(v) => setG({ adaptiveResolution: v, preset: g.preset })}
          />
          <Field label="FPS limit">
            <Segmented
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
          </Field>
          <Toggle label="Anti-aliasing (FXAA)" checked={g.antialias} onChange={(v) => setG({ antialias: v })} />
          <Toggle label="Post-processing (tone mapping, contrast, vignette)" checked={g.postFx} onChange={(v) => setG({ postFx: v })} />
          <Field label="Lighting">
            <Segmented
              value={g.lighting}
              onChange={(v) => setG({ lighting: v })}
              options={[
                { value: 'simple', label: 'Simple' },
                { value: 'full', label: 'Full' },
              ]}
            />
          </Field>
          <Field label="Textures">
            <Segmented
              value={g.textureQuality}
              onChange={(v) => setG({ textureQuality: v })}
              options={[
                { value: 'low', label: 'Low' },
                { value: 'high', label: 'High' },
              ]}
            />
          </Field>
          {/* on CrazyGames the site's own fullscreen button is the only one allowed */}
          {!__CRAZYGAMES__ && (
            <Toggle
              label="Fullscreen on start"
              hint="Uses Keyboard Lock so Ctrl (crouch) + W can't close the tab. When off, crouch with C instead of Ctrl."
              checked={g.fullscreen}
              onChange={(v) => setG({ fullscreen: v, preset: g.preset })}
            />
          )}
          {__LOCAL_MODELS__ && (
            <Field label="Gun models">
              <Segmented
                value={g.gunModels}
                onChange={(v) => setG({ gunModels: v })}
                options={[
                  { value: 'skins', label: 'Skins' },
                  { value: 'simple', label: 'Simple' },
                ]}
              />
              <p className="mt-2 text-xs text-dim">
                Skins: 3D models for all eight guns (the soldiers carry the Kestrel). Simple: guns built from basic shapes, lighter on slow machines. Applies on
                the next session.
              </p>
            </Field>
          )}
          <Field label="First-person arms">
            <Segmented
              value={!__LOCAL_MODELS__ && g.fpArms === 'animated' ? 'rigged' : g.fpArms}
              onChange={(v) => setG({ fpArms: v })}
              options={[
                ...(__LOCAL_MODELS__ ? [{ value: 'animated' as const, label: 'Animated' }] : []),
                { value: 'rigged', label: 'Rigged arms' },
                { value: 'simple', label: 'Simple hands' },
              ]}
            />
            <p className="mt-2 text-xs text-dim">
              {__LOCAL_MODELS__
                ? 'Animated: gloved arms with real draw, fire and reload animations (public/models/fp-arms-anim.glb). Rigged: the fingerless-glove arm model posed onto each gun (public/models/fp-arms.glb). Either falls back to built-in jointed arms if its file is missing.'
                : 'Rigged arms are jointed arms that wrap each gun.'}{' '}
              Applies on the next session.
            </p>
          </Field>
          {__LOCAL_MODELS__ && (
            <Field label="Bot model">
              <Segmented
                value={g.botModel}
                onChange={(v) => setG({ botModel: v })}
                options={[
                  { value: 'agent', label: 'Agents (random)' },
                  { value: 'dummy', label: 'Training dummy' },
                ]}
              />
              <p className="mt-2 text-xs text-dim">
                Each bot wears a random agent model (~15–25k triangles per bot). Pick the dummy on slower machines or for big deathmatches. Applies on the next
                session.
              </p>
            </Field>
          )}
          <Field label="Renderer">
            <Segmented
              value={g.renderer}
              onChange={(v) => setG({ renderer: v, preset: g.preset })}
              options={[
                { value: 'webgl2', label: 'WebGL 2' },
                { value: 'webgpu', label: 'WebGPU (experimental)' },
              ]}
            />
            <p className="mt-2 text-xs text-dim">WebGPU is attempted only when supported and falls back to WebGL 2 automatically. Shadows/effects/renderer apply on the next session.</p>
          </Field>
        </Card>
        )}

        {section === 'audio' && (
        <Card title="Audio">
          <Slider label="Master" value={settings.audio.master} min={0} max={1} step={0.01} onChange={(v) => setA({ master: v })} format={(v) => `${Math.round(v * 100)}%`} />
          <Slider label="Weapons" value={settings.audio.weapons} min={0} max={1} step={0.01} onChange={(v) => setA({ weapons: v })} format={(v) => `${Math.round(v * 100)}%`} />
          <Slider label="Effects & feedback" value={settings.audio.effects} min={0} max={1} step={0.01} onChange={(v) => setA({ effects: v })} format={(v) => `${Math.round(v * 100)}%`} />
          <Slider label="Footsteps" value={settings.audio.footsteps} min={0} max={1} step={0.01} onChange={(v) => setA({ footsteps: v })} format={(v) => `${Math.round(v * 100)}%`} />
          <Toggle label="Hit & headshot sounds" checked={settings.audio.hitSounds} onChange={(v) => setA({ hitSounds: v })} />
          <p className="mt-2 text-xs text-dim">All sounds are synthesised in the browser (Web Audio). Enemy shots and footsteps are positional (HRTF) and muffled behind walls.</p>
        </Card>
        )}

        {section === 'hud' && (
        <Card title="HUD">
          <div className="grid gap-x-6 md:grid-cols-2">
            <Toggle label="FPS counter" checked={settings.hud.showFps} onChange={(v) => setH({ showFps: v })} />
            <Toggle label="Performance metrics" checked={settings.hud.showPerfMetrics} onChange={(v) => setH({ showPerfMetrics: v })} />
            <Toggle label="Session timer" checked={settings.hud.showTimer} onChange={(v) => setH({ showTimer: v })} />
            <Toggle label="Kill / death counter" checked={settings.hud.showKills} onChange={(v) => setH({ showKills: v })} />
            <Toggle label="Health & shield" checked={settings.hud.showHealth} onChange={(v) => setH({ showHealth: v })} />
            <Toggle label="Weapon & ammo" checked={settings.hud.showAmmo} onChange={(v) => setH({ showAmmo: v })} />
            <Toggle label="Kill feed" checked={settings.hud.showKillFeed} onChange={(v) => setH({ showKillFeed: v })} />
            <Toggle label="Hit markers" checked={settings.hud.showHitmarkers} onChange={(v) => setH({ showHitmarkers: v })} />
            <Toggle label="Moving-shot warning" checked={settings.hud.showMoveWarning} onChange={(v) => setH({ showMoveWarning: v })} />
            <Toggle label="Damage direction" checked={settings.hud.showDamageIndicator} onChange={(v) => setH({ showDamageIndicator: v })} />
            <Toggle label="Minimap" checked={settings.hud.showMinimap} onChange={(v) => setH({ showMinimap: v })} />
            <Slider
              label="Minimap: always show enemies within"
              value={settings.hud.minimapEnemyRange}
              min={0}
              max={60}
              step={5}
              onChange={(v) => setH({ minimapEnemyRange: v })}
              format={(v) => (v === 0 ? 'off (none shown)' : `${v} m`)}
            />
          </div>
        </Card>
        )}

        {section === 'controls' && (
        <Card title="Controls">
          <div className="divide-y divide-line text-sm">
            {KEYS.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 py-1.5">
                <kbd className="border border-line bg-bg px-2 py-0.5 font-mono text-xs">{k}</kbd>
                <span className="text-right text-mute">{v}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-dim">Optimised for keyboard and mouse on desktop Chrome/Edge (Firefox works where Pointer Lock raw input is unsupported). Mobile is not supported.</p>
        </Card>
        )}

        {section === 'data' && (
        <Card title="Data">
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
                  a.download = 'holdline-settings.json';
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
          <p className="mt-3 text-xs text-dim">Settings, crosshair presets and session history are stored locally in this browser (localStorage).</p>
        </Card>
        )}
        </div>
      </div>
    </div>
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
    <Card title="Profile">
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
        The name other players see in multiplayer. Your agent ({agent.name}) is picked on the Multiplayer screen.
        {inRoom && ' A room keeps the name you joined with: the new one shows from the next room.'}
      </p>
    </Card>
  );
}
