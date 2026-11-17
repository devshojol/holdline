import { Check, Copy, Crown, Link as LinkIcon, LogOut, Play, Square, UserX, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { WeaponId } from '../types';
import { MAP_SUMMARIES } from '../game/maps/registry';
import { ALL_WEAPONS, WEAPONS } from '../game/weapons/weaponConfigs';
import { multiplayer, useMultiplayer } from '../multiplayer/client';
import { MIN_PLAYERS, type RoomPlayer, type RoomState, type Team } from '../net/protocol';
import { ROOM_OPTIONS, type MatchMode, type RoomSettings, type WeaponRule } from '../net/settings';
import { mapName } from '../utils/labels';
import { MapPreview } from './MapPreview';
import { Scoreboard } from './Scoreboard';
import { Badge, Button, Card, ConfirmButton, Field, PageHeader, Segmented, Toggle, cx } from './ui';

const MODE_LABEL: Record<MatchMode, string> = { deathmatch: 'Deathmatch', 'team-deathmatch': 'Team Deathmatch' };
const WEAPON_RULE_LABEL: Record<WeaponRule, string> = {
  all: 'All',
  rifles: 'Rifles only',
  sidearms: 'Sidearms only',
  'no-operator': 'No Operator',
  single: 'One gun',
};
const TEAM_LABEL: Record<Team, string> = { a: 'Team A', b: 'Team B' };

/** Re-render on a timer while something on screen counts down. */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function clock(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CopyButton({ text, children }: { text: string; children: React.ReactNode }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const t = setTimeout(() => setState('idle'), 2000);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <Button variant="outline" size="sm" onClick={() => void copyText(text).then((ok) => setState(ok ? 'copied' : 'failed'))}>
      {state === 'copied' ? <Check size={16} className="text-ok" /> : children}
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy blocked — select it by hand' : null}
    </Button>
  );
}

export function RoomLobby({ room }: { room: RoomState }) {
  const myId = useMultiplayer((s) => s.playerId);
  const status = useMultiplayer((s) => s.status);
  const error = useMultiplayer((s) => s.error);
  const clockOffset = useMultiplayer((s) => s.clockOffset);
  const inMatch = useMultiplayer((s) => s.match !== null);
  const result = useMultiplayer((s) => s.result);
  const now = useNow(room.phase !== 'lobby') + clockOffset;

  const me = room.players.find((p) => p.id === myId);
  const isHost = !!me?.host;
  const inLobby = room.phase === 'lobby';
  const connected = room.players.filter((p) => p.connected).length;
  const canStart = isHost && inLobby && connected >= MIN_PLAYERS;
  const link = multiplayer.inviteLink(room.code);
  const remaining = room.phaseEndsAt - now;
  const quick = room.kind === 'quick';

  return (
    <div>
      <PageHeader kicker={quick ? 'Quick match' : 'Custom room'} title={quick ? mapName(room.settings.mapId) : `Room ${room.code}`}>
        <div className="flex flex-wrap items-center gap-2">
          {inLobby && me && !quick && (
            <Button variant={me.ready ? 'outline' : 'primary'} onClick={() => multiplayer.setReady(!me.ready)}>
              <Check size={18} /> {me.ready ? 'Ready — click to undo' : 'Ready'}
            </Button>
          )}
          {isHost && inLobby && (
            <Button size="lg" disabled={!canStart} title={canStart ? undefined : `A match needs at least ${MIN_PLAYERS} players`} onClick={() => multiplayer.start()}>
              <Play size={20} /> Start match
            </Button>
          )}
          {room.phase === 'playing' && inMatch && (
            <Button size="lg" onClick={() => multiplayer.showGame()}>
              <Play size={20} /> Return to match
            </Button>
          )}
          {isHost && (room.phase === 'countdown' || room.phase === 'playing') && (
            <Button variant="danger" onClick={() => multiplayer.end()}>
              <Square size={16} /> {room.phase === 'countdown' ? 'Cancel start' : 'End match'}
            </Button>
          )}
          <ConfirmButton size="md" confirmLabel="Click again to leave" onConfirm={() => multiplayer.leaveRoom()}>
            <LogOut size={16} /> Leave
          </ConfirmButton>
        </div>
      </PageHeader>

      {status === 'reconnecting' && (
        <div role="status" className="mb-5 flex items-center gap-2 border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
          <WifiOff size={16} /> Connection lost. Reconnecting — your place in the room is kept for 30 seconds.
        </div>
      )}
      {error && (
        <div role="alert" className="mb-5 flex items-center justify-between gap-3 border border-accent/50 bg-accent/10 px-4 py-3 text-sm text-ink">
          <span>{error}</span>
          <Button size="sm" variant="ghost" onClick={() => multiplayer.clearError()}>
            Dismiss
          </Button>
        </div>
      )}

      {room.phase === 'countdown' && (
        <PhaseBanner tone="accent" label={quick ? 'Match found · starts in' : 'Match starts in'} value={String(Math.max(0, Math.ceil(remaining / 1000)))} note={`${mapName(room.settings.mapId)} · ${MODE_LABEL[room.settings.mode]}`} />
      )}
      {room.phase === 'playing' && (
        <PhaseBanner
          tone="ok"
          label="Match in progress"
          value={clock(remaining)}
          note={inMatch ? 'You stepped out to the room. Your player is still standing in the match.' : undefined}
        />
      )}
      {room.phase === 'scoreboard' && <PhaseBanner tone="mute" label={quick ? 'Match over · this room closes in' : 'Match over · back to the lobby in'} value={String(Math.max(0, Math.ceil(remaining / 1000)))} />}
      {result && room.phase !== 'playing' && room.phase !== 'countdown' && (
        <Card className="mb-5" title={room.phase === 'scoreboard' ? 'Final score' : 'Last match'}>
          <Scoreboard scores={result.scores} settings={result.settings} me={myId} winner={result.winner} />
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_440px]">
        <div className="space-y-5">
          {!quick && (
          <Card title="Invite friends">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <div>
                <div className="text-xs uppercase tracking-widest text-dim">Room code</div>
                <div className="select-all font-display text-5xl font-bold leading-none tracking-[0.2em] text-ink">{room.code}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <CopyButton text={link}>
                  <LinkIcon size={16} /> Copy invite link
                </CopyButton>
                <CopyButton text={room.code}>
                  <Copy size={16} /> Copy code
                </CopyButton>
              </div>
            </div>
            <div className="mt-3 select-all break-all text-xs text-dim">{link}</div>
          </Card>
          )}

          <Card title={`Players · ${room.players.length} / ${room.settings.maxPlayers}`} right={!inLobby || quick ? undefined : <span className="text-xs text-dim">{isHost ? 'You are the host' : 'Waiting for the host to start'}</span>}>
            <ul className="divide-y divide-line">
              {room.players.map((p) => (
                <PlayerRow key={p.id} player={p} me={p.id === myId} isHost={isHost} teams={room.settings.mode === 'team-deathmatch'} editable={inLobby} showReady={!quick} />
              ))}
              {Array.from({ length: room.settings.maxPlayers - room.players.length }, (_, i) => (
                <li key={`empty-${i}`} className="py-2.5 text-sm text-dim">
                  Open slot
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-5">
          <SettingsPanel settings={room.settings} editable={isHost && inLobby} players={room.players.length} fixed={quick} />
        </div>
      </div>
    </div>
  );
}

function PhaseBanner({ tone, label, value, note }: { tone: 'accent' | 'ok' | 'mute'; label: string; value: string; note?: string }) {
  const tones = { accent: 'border-accent/50 bg-accent/10', ok: 'border-ok/40 bg-ok/10', mute: 'border-line bg-panel2' };
  return (
    <div role="status" className={cx('mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 border px-5 py-4', tones[tone])}>
      <div>
        <div className="text-xs uppercase tracking-widest text-mute">{label}</div>
        <div className="font-display tabular text-5xl font-bold leading-none text-ink">{value}</div>
      </div>
      {note && <p className="max-w-xl text-sm text-mute">{note}</p>}
    </div>
  );
}

function PlayerRow({ player, me, isHost, teams, editable, showReady }: { player: RoomPlayer; me: boolean; isHost: boolean; teams: boolean; editable: boolean; showReady: boolean }) {
  const canMove = editable && (me || isHost);
  return (
    <li className={cx('flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5', !player.connected && 'opacity-50')}>
      <span className="min-w-0 flex-1 truncate text-base text-ink">
        {player.name}
        {me && <span className="ml-2 text-xs text-dim">you</span>}
      </span>
      {player.host && (
        <Badge tone="accent">
          <Crown size={11} className="mr-1" /> Host
        </Badge>
      )}
      {teams &&
        player.team &&
        (canMove ? (
          <Segmented<Team>
            value={player.team}
            onChange={(t) => multiplayer.setTeam(t, me ? undefined : player.id)}
            options={[
              { value: 'a', label: 'A' },
              { value: 'b', label: 'B' },
            ]}
          />
        ) : (
          <Badge>{TEAM_LABEL[player.team]}</Badge>
        ))}
      {!player.connected ? <Badge tone="warn">Reconnecting</Badge> : !showReady ? null : player.ready ? <Badge tone="ok">Ready</Badge> : <Badge>Not ready</Badge>}
      <span className="tabular w-14 text-right text-xs text-dim">{player.connected && player.ping >= 0 ? `${player.ping} ms` : '—'}</span>
      {isHost && !me && (
        <span className="flex gap-1">
          <Button size="sm" variant="ghost" title={`Make ${player.name} the host`} disabled={!player.connected} onClick={() => multiplayer.makeHost(player.id)}>
            <Crown size={15} />
            <span className="sr-only">Make host</span>
          </Button>
          <Button size="sm" variant="ghost" title={`Remove ${player.name} from the room`} onClick={() => multiplayer.kick(player.id)}>
            <UserX size={15} />
            <span className="sr-only">Remove</span>
          </Button>
        </span>
      )}
    </li>
  );
}

/** `fixed`: quick match rules, which nobody sets. */
function SettingsPanel({ settings, editable, players, fixed }: { settings: RoomSettings; editable: boolean; players: number; fixed: boolean }) {
  const update = (patch: Partial<RoomSettings>) => multiplayer.updateSettings(patch);
  /** Options for a Segmented: everything but the current value is disabled for players who can't edit. */
  const opts = <T extends string | number>(values: readonly T[], current: T, label: (v: T) => string) =>
    values.map((v) => ({ value: v, label: label(v), disabled: !editable && v !== current }));
  const teams = settings.mode === 'team-deathmatch';

  return (
    <>
      <Card title="Map" right={!editable && !fixed ? <span className="text-xs text-dim">Set by the host</span> : undefined}>
        <MapPreview mapId={settings.mapId} focus={false} showSight={false} className="mb-3" />
        <div className="grid grid-cols-2 gap-1.5">
          {MAP_SUMMARIES.map((m) => (
            <button
              key={m.id}
              type="button"
              disabled={!editable && m.id !== settings.mapId}
              aria-pressed={m.id === settings.mapId}
              onClick={() => editable && update({ mapId: m.id })}
              className={cx(
                'border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-35',
                m.id === settings.mapId ? 'border-accent bg-accent/10' : 'border-line bg-bg/50 hover:border-mute',
              )}
            >
              <div className="font-display text-base font-bold uppercase leading-tight">{m.name}</div>
              <div className="text-xs text-mute">{m.inspiredBy}-inspired</div>
            </button>
          ))}
        </div>
      </Card>

      <Card title="Rules">
        <Field label="Mode">
          <Segmented value={settings.mode} onChange={(mode) => update({ mode })} options={opts(ROOM_OPTIONS.mode, settings.mode, (m) => MODE_LABEL[m])} />
        </Field>
        <Field label="Time limit">
          <Segmented value={settings.timeLimitMin} onChange={(timeLimitMin) => update({ timeLimitMin })} options={opts(ROOM_OPTIONS.timeLimitMin, settings.timeLimitMin, (m) => `${m} min`)} />
        </Field>
        <Field label={teams ? 'Kill limit (team total)' : 'Kill limit'}>
          <Segmented value={settings.killLimit} onChange={(killLimit) => update({ killLimit })} options={opts(ROOM_OPTIONS.killLimit, settings.killLimit, (k) => (k === 0 ? 'Off' : String(k)))} />
        </Field>
        <Field label="Max players">
          <Segmented
            value={settings.maxPlayers}
            onChange={(maxPlayers) => update({ maxPlayers })}
            options={[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({
              value: n,
              label: String(n),
              disabled: (!editable && n !== settings.maxPlayers) || n < players,
              title: n < players ? 'There are already more players than this in the room' : undefined,
            }))}
          />
        </Field>
        <Field label="Weapons">
          <Segmented value={settings.weapons} onChange={(weapons) => update({ weapons })} options={opts(ROOM_OPTIONS.weapons, settings.weapons, (w) => WEAPON_RULE_LABEL[w])} />
          {settings.weapons === 'single' && (
            <Segmented<WeaponId>
              className="mt-2"
              value={settings.singleWeapon}
              onChange={(singleWeapon) => update({ singleWeapon })}
              options={opts(ALL_WEAPONS, settings.singleWeapon, (id) => WEAPONS[id].name)}
            />
          )}
        </Field>
        <Field label="Respawn delay">
          <Segmented value={settings.respawnDelaySec} onChange={(respawnDelaySec) => update({ respawnDelaySec })} options={opts(ROOM_OPTIONS.respawnDelaySec, settings.respawnDelaySec, (s) => `${s} s`)} />
        </Field>
        <Field label="Spawn protection">
          <Segmented
            value={settings.spawnProtectionSec}
            onChange={(spawnProtectionSec) => update({ spawnProtectionSec })}
            options={opts(ROOM_OPTIONS.spawnProtectionSec, settings.spawnProtectionSec, (s) => (s === 0 ? 'Off' : `${s} s`))}
          />
        </Field>
        <div className="mt-2 border-t border-line pt-2">
          <Switch label="Headshots only" hint="Body and leg hits deal no damage" checked={settings.headshotsOnly} editable={editable} onChange={(headshotsOnly) => update({ headshotsOnly })} />
          <Switch label="Infinite ammo" hint="No reserve limit; reloads still happen" checked={settings.infiniteAmmo} editable={editable} onChange={(infiniteAmmo) => update({ infiniteAmmo })} />
          <Switch label="Join in progress" hint="Friends can join after the match has started" checked={settings.joinInProgress} editable={editable} onChange={(joinInProgress) => update({ joinInProgress })} />
          {teams && <Switch label="Friendly fire" hint="Teammates can hurt each other" checked={settings.friendlyFire} editable={editable} onChange={(friendlyFire) => update({ friendlyFire })} />}
        </div>
      </Card>
    </>
  );
}

/** A toggle the host can flip; everyone else sees its value. */
function Switch({ label, hint, checked, editable, onChange }: { label: string; hint: string; checked: boolean; editable: boolean; onChange: (v: boolean) => void }) {
  if (editable) return <Toggle label={label} hint={hint} checked={checked} onChange={onChange} />;
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span>
        <span className="block text-sm text-ink">{label}</span>
        <span className="block text-xs text-dim">{hint}</span>
      </span>
      <Badge tone={checked ? 'ok' : 'mute'}>{checked ? 'On' : 'Off'}</Badge>
    </div>
  );
}
