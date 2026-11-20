import { Bot, Check, Copy, Crown, Link as LinkIcon, LogOut, Play, Square, UserPlus, UserX, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { WeaponId } from '../types';
import { MAP_SUMMARIES } from '../game/maps/registry';
import { ALL_WEAPONS, WEAPONS } from '../game/weapons/weaponConfigs';
import { multiplayer, useMultiplayer } from '../multiplayer/client';
import { MIN_PLAYERS, type RoomPlayer, type RoomState, type Team } from '../net/protocol';
import { ROOM_OPTIONS, type BotDifficulty, type MatchMode, type RoomSettings, type WeaponRule } from '../net/settings';
import { mapName } from '../utils/labels';
import { AgentPortrait } from './AgentPicker';
import { AGENTS, getAgent } from '../game/agents';
import { MapPreview } from './MapPreview';
import { MatchResultView } from './Scoreboard';
import { Badge, Button, Card, ConfirmButton, Cycler, PageHeader, Toggle, cx } from './ui';

const MODE_LABEL: Record<MatchMode, string> = { deathmatch: 'Deathmatch', 'team-deathmatch': 'Team Deathmatch' };
const WEAPON_RULE_LABEL: Record<WeaponRule, string> = {
  all: 'All',
  rifles: 'Rifles only',
  sidearms: 'Sidearms only',
  'no-operator': 'No Monarch',
  single: 'One gun',
};
const TEAM_LABEL: Record<Team, string> = { a: 'Team A', b: 'Team B' };
const DIFFICULTY_LABEL: Record<BotDifficulty, string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };

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
  // someone to play against: a second person, or bots
  const canStart = isHost && inLobby && Math.max(connected, room.settings.botFill) >= MIN_PLAYERS;
  const teams = room.settings.mode === 'team-deathmatch';
  const slots = room.settings.maxPlayers;
  /** Places bots will take once the match starts. */
  const botSlots = Math.max(0, Math.min(slots, room.settings.botFill) - room.players.length);
  const link = multiplayer.inviteLink(room.code);
  const remaining = room.phaseEndsAt - now;
  const quick = room.kind === 'quick';

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <PageHeader kicker={quick ? 'Quick match' : 'Custom room'} title={quick ? mapName(room.settings.mapId) : `Room ${room.code}`}>
        <div className="flex flex-wrap items-center gap-2">
          {inLobby && me && !quick && (
            <Button variant={me.ready ? 'outline' : 'primary'} onClick={() => multiplayer.setReady(!me.ready)}>
              <Check size={18} /> {me.ready ? 'Ready — click to undo' : 'Ready'}
            </Button>
          )}
          {isHost && inLobby && (
            <Button size="lg" disabled={!canStart} title={canStart ? undefined : `A match needs at least ${MIN_PLAYERS} players: invite a friend or turn on bots`} onClick={() => multiplayer.start()}>
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
        <div role="status" className="mb-3 flex shrink-0 items-center gap-2 border border-warn/40 bg-warn/10 px-4 py-2 text-sm text-warn">
          <WifiOff size={16} /> Connection lost. Reconnecting — your place in the room is kept for 30 seconds.
        </div>
      )}
      {error && (
        <div role="alert" className="mb-3 flex shrink-0 items-center justify-between gap-3 border border-accent/50 bg-accent/10 px-4 py-2 text-sm text-ink">
          <span>{error}</span>
          <Button size="sm" variant="ghost" onClick={() => multiplayer.clearError()}>
            Dismiss
          </Button>
        </div>
      )}

      {room.phase === 'playing' && (
        <PhaseBanner
          tone="ok"
          label="Match in progress"
          value={clock(remaining)}
          note={inMatch ? 'You stepped out to the room. Your player is still standing in the match.' : undefined}
        />
      )}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_270px_320px] gap-4">
        <div className="flex min-h-0 flex-col gap-3">
          {!quick && (
            <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 border border-white/10 bg-black/30 px-4 py-2.5">
              <div>
                <div className="text-xs uppercase tracking-widest text-dim">Room code</div>
                <div className="select-all font-display text-3xl leading-none tracking-[0.15em] text-ink">{room.code}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <CopyButton text={link}>
                  <LinkIcon size={15} /> Copy invite link
                </CopyButton>
                <CopyButton text={room.code}>
                  <Copy size={15} /> Code
                </CopyButton>
              </div>
            </div>
          )}
          <Card className="flex min-h-0 flex-1 flex-col !p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="font-display text-sm uppercase text-accent">
                Players · {room.players.length} / {slots}
              </span>
              <span className="truncate text-xs text-dim">
                {botSlots > 0 && `${botSlots} ${botSlots === 1 ? 'bot fills' : 'bots fill'} in · `}
                {!inLobby || quick ? MODE_LABEL[room.settings.mode] : isHost ? 'You are the host' : 'Waiting for the host'}
              </span>
            </div>
            <ul className="grid min-h-0 flex-1 grid-cols-5 grid-rows-2 gap-1.5">
              {room.players.map((p) => (
                <PlayerCard key={p.id} player={p} me={p.id === myId} isHost={isHost} teams={teams} editable={inLobby} showReady={!quick} />
              ))}
              {Array.from({ length: slots - room.players.length }, (_, i) => {
                const bot = i < botSlots;
                return (
                  <li key={`empty-${i}`} className="tal-slot items-center justify-center gap-1 text-center text-dim" data-empty="true" title={bot ? `${DIFFICULTY_LABEL[room.settings.botDifficulty]} bot, joins at the start` : undefined}>
                    {bot ? <Bot size={20} /> : <UserPlus size={20} className="opacity-50" />}
                    <span className="font-display text-xs uppercase">{bot ? 'Bot' : 'Open'}</span>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>

        <div className="flex min-h-0 flex-col gap-3">
          <SoldierCard note={inLobby ? undefined : 'Shows from the next match'} />
          <MapCard settings={room.settings} editable={isHost && inLobby} fixed={quick} />
        </div>

        <RulesCard settings={room.settings} editable={isHost && inLobby} players={room.players.length} />
      </div>

      {/* the countdown and the result sit over the lobby instead of pushing it off the screen */}
      {(room.phase === 'countdown' || (result && room.phase !== 'playing')) && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-black/70 backdrop-blur-sm">
          {room.phase === 'countdown' ? (
            <div role="status" className="text-center">
              <div className="font-display text-sm uppercase tracking-[0.3em] text-mute">{quick ? 'Match found' : 'Match starting'}</div>
              <div className="font-display tabular text-9xl leading-none text-white">
                <span key={Math.ceil(remaining / 1000)} className="tal-count">
                  {Math.max(0, Math.ceil(remaining / 1000))}
                </span>
              </div>
              <div className="mt-2 font-display text-xl uppercase text-accent">
                {mapName(room.settings.mapId)} · {MODE_LABEL[room.settings.mode]}
              </div>
            </div>
          ) : (
            result && (
              <div className="w-[min(760px,94%)]">
                <MatchResultView scores={result.scores} settings={result.settings} winner={result.winner} me={myId}>
                  {room.phase === 'scoreboard' ? (
                    <span role="status" className="text-sm text-mute">
                      {quick ? 'This room closes in' : 'Back to the lobby in'} <span className="tabular font-semibold text-ink">{Math.max(0, Math.ceil(remaining / 1000))}</span> s
                    </span>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => multiplayer.dismissResult()}>
                      Back to the lobby
                    </Button>
                  )}
                </MatchResultView>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

/** Your soldier, with arrows to change. */
function SoldierCard({ note }: { note?: string }) {
  const agent = getAgent(useMultiplayer((s) => s.agent));
  const i = AGENTS.findIndex((a) => a.id === agent.id);
  const step = (d: number) => multiplayer.setAgent(AGENTS[(i + d + AGENTS.length) % AGENTS.length].id);
  return (
    <Card className="!p-3">
      <div className="mb-1 font-display text-sm uppercase text-accent">Your soldier</div>
      <div className="flex items-center gap-2">
        <button type="button" className="tal-slab grid h-9 w-9 shrink-0 place-items-center" onClick={() => step(-1)} aria-label="Previous soldier">
          ◀
        </button>
        <AgentPortrait key={agent.id} agent={agent} className="h-24 min-w-0 flex-1 border border-white/10" />
        <button type="button" className="tal-slab grid h-9 w-9 shrink-0 place-items-center" onClick={() => step(1)} aria-label="Next soldier">
          ▶
        </button>
      </div>
      <div className="mt-1 text-center font-display text-lg uppercase" style={{ color: agent.accent }}>
        {agent.name}
      </div>
      {note && <div className="text-center text-xs text-dim">{note}</div>}
    </Card>
  );
}

function MapCard({ settings, editable, fixed }: { settings: RoomSettings; editable: boolean; fixed: boolean }) {
  return (
    <Card className="flex min-h-0 flex-1 flex-col !p-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-display text-sm uppercase text-accent">Map</span>
        {!editable && !fixed && <span className="text-xs text-dim">Host picks</span>}
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="absolute inset-0 grid place-items-center">
          <div className="aspect-[52/48] max-h-full w-full">
            <MapPreview mapId={settings.mapId} focus={false} showSight={false} className="h-full w-full" />
          </div>
        </div>
      </div>
      <Cycler label="Map" disabled={!editable} value={settings.mapId} onChange={(mapId) => multiplayer.updateSettings({ mapId })} options={MAP_SUMMARIES.map((m) => ({ value: m.id, label: m.name, title: m.setting }))} />
    </Card>
  );
}

function PhaseBanner({ tone, label, value, note }: { tone: 'accent' | 'ok' | 'mute'; label: string; value: string; note?: string }) {
  const tones = { accent: 'border-accent/50 bg-accent/10', ok: 'border-ok/40 bg-ok/10', mute: 'border-line bg-panel2' };
  return (
    <div role="status" className={cx('mb-3 flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 border px-4 py-2', tones[tone])}>
      <div>
        <div className="text-xs uppercase tracking-widest text-mute">{label}</div>
        <div className="font-display tabular text-3xl leading-none text-ink">{value}</div>
      </div>
      {note && <p className="max-w-xl text-sm text-mute">{note}</p>}
    </div>
  );
}

function PlayerCard({ player, me, isHost, teams, editable, showReady }: { player: RoomPlayer; me: boolean; isHost: boolean; teams: boolean; editable: boolean; showReady: boolean }) {
  const canMove = editable && (me || isHost);
  const agent = getAgent(player.agent);
  return (
    <li className={cx('tal-slot min-h-0 !p-1.5', !player.connected && 'opacity-50')} data-me={me} data-ready={showReady && player.ready && player.connected} title={`${player.name} · ${agent.name}${player.ping >= 0 ? ` · ${player.ping} ms` : ''}`}>
      <div className="relative min-h-0 flex-1">
        <AgentPortrait agent={agent} className="absolute inset-0 h-full w-full border border-white/10" />
        {player.host && (
          <span className="absolute left-1 top-1 grid h-5 w-5 place-items-center bg-accent text-[#1c1203]" title="Host">
            <Crown size={12} />
          </span>
        )}
      </div>
      <div className="mt-1 truncate font-display text-xs uppercase text-ink">{player.name}</div>
      <div className="flex items-center gap-1">
        {!player.connected ? (
          <span className="text-xs text-warn">Away</span>
        ) : showReady ? (
          <span className={cx('text-xs', player.ready ? 'text-ok' : 'text-dim')}>{player.ready ? 'Ready' : 'Not ready'}</span>
        ) : (
          <span className="text-xs text-dim">{me ? 'You' : agent.name}</span>
        )}
        {teams &&
          player.team &&
          (canMove ? (
            <button type="button" className="ml-auto border border-line px-1 font-display text-xs uppercase" title="Switch team" onClick={() => multiplayer.setTeam(player.team === 'a' ? 'b' : 'a', me ? undefined : player.id)}>
              {player.team.toUpperCase()}
            </button>
          ) : (
            <span className="ml-auto text-xs text-mute">{TEAM_LABEL[player.team]}</span>
          ))}
        {isHost && !me && (
          <span className="ml-auto flex">
            <button type="button" className="p-0.5 text-dim hover:text-accent disabled:opacity-40" title={`Make ${player.name} the host`} disabled={!player.connected} onClick={() => multiplayer.makeHost(player.id)}>
              <Crown size={13} />
            </button>
            <button type="button" className="p-0.5 text-dim hover:text-accent" title={`Remove ${player.name}`} onClick={() => multiplayer.kick(player.id)}>
              <UserX size={13} />
            </button>
          </span>
        )}
      </div>
    </li>
  );
}

/** The match rules: one line each, the host changes them, everyone else sees them. */
function RulesCard({ settings, editable, players }: { settings: RoomSettings; editable: boolean; players: number }) {
  const update = (patch: Partial<RoomSettings>) => multiplayer.updateSettings(patch);
  const o = <T extends string | number>(values: readonly T[], label: (v: T) => string) => values.map((v) => ({ value: v, label: label(v) }));
  const teams = settings.mode === 'team-deathmatch';
  return (
    <Card className="flex min-h-0 flex-col !p-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-display text-sm uppercase text-accent">Rules</span>
        {!editable && <span className="text-xs text-dim">Host sets these</span>}
      </div>
      <Cycler label="Mode" disabled={!editable} value={settings.mode} onChange={(mode) => update({ mode })} options={o(ROOM_OPTIONS.mode, (m) => MODE_LABEL[m])} />
      <Cycler label="Time" disabled={!editable} value={settings.timeLimitMin} onChange={(timeLimitMin) => update({ timeLimitMin })} options={o(ROOM_OPTIONS.timeLimitMin, (m) => `${m} min`)} />
      <Cycler label={teams ? 'Team kills' : 'Kill limit'} disabled={!editable} value={settings.killLimit} onChange={(killLimit) => update({ killLimit })} options={o(ROOM_OPTIONS.killLimit, (k) => (k === 0 ? 'Off' : String(k)))} />
      <Cycler label="Players" disabled={!editable} value={settings.maxPlayers} onChange={(maxPlayers) => update({ maxPlayers })} options={[2, 3, 4, 5, 6, 7, 8, 9, 10].filter((n) => n >= players).map((n) => ({ value: n, label: String(n) }))} />
      <Cycler label="Weapons" disabled={!editable} value={settings.weapons} onChange={(weapons) => update({ weapons })} options={o(ROOM_OPTIONS.weapons, (w) => WEAPON_RULE_LABEL[w])} />
      {settings.weapons === 'single' && <Cycler label="The gun" disabled={!editable} value={settings.singleWeapon} onChange={(singleWeapon: WeaponId) => update({ singleWeapon })} options={o(ALL_WEAPONS, (id) => WEAPONS[id].name)} />}
      <Cycler label="Respawn" disabled={!editable} value={settings.respawnDelaySec} onChange={(respawnDelaySec) => update({ respawnDelaySec })} options={o(ROOM_OPTIONS.respawnDelaySec, (s) => `${s} s`)} />
      <Cycler label="Spawn shield" disabled={!editable} value={settings.spawnProtectionSec} onChange={(spawnProtectionSec) => update({ spawnProtectionSec })} options={o(ROOM_OPTIONS.spawnProtectionSec, (s) => (s === 0 ? 'Off' : `${s} s`))} />
      <Cycler label="Bots" hint="Bots make up the numbers and step out as people join" disabled={!editable} value={settings.botFill} onChange={(botFill) => update({ botFill })} options={o(ROOM_OPTIONS.botFill, (n) => (n === 0 ? 'Off' : `Fill to ${n}`))} />
      {settings.botFill > 0 && <Cycler label="Bot skill" disabled={!editable} value={settings.botDifficulty} onChange={(botDifficulty: BotDifficulty) => update({ botDifficulty })} options={o(ROOM_OPTIONS.botDifficulty, (d) => DIFFICULTY_LABEL[d])} />}
      <div className="mt-1 grid grid-cols-2 gap-x-3 border-t border-line pt-1">
        <Switch label="Headshots only" checked={settings.headshotsOnly} editable={editable} onChange={(headshotsOnly) => update({ headshotsOnly })} />
        <Switch label="Endless ammo" checked={settings.infiniteAmmo} editable={editable} onChange={(infiniteAmmo) => update({ infiniteAmmo })} />
        <Switch label="Late join" checked={settings.joinInProgress} editable={editable} onChange={(joinInProgress) => update({ joinInProgress })} />
        {teams && <Switch label="Friendly fire" checked={settings.friendlyFire} editable={editable} onChange={(friendlyFire) => update({ friendlyFire })} />}
      </div>
    </Card>
  );
}

/** A toggle the host can flip; everyone else sees its value. */
function Switch({ label, checked, editable, onChange }: { label: string; checked: boolean; editable: boolean; onChange: (v: boolean) => void }) {
  if (editable) return <Toggle label={label} checked={checked} onChange={onChange} />;
  return (
    <div className="flex items-center justify-between gap-2 py-2">
      <span className="text-sm text-ink">{label}</span>
      <Badge tone={checked ? 'ok' : 'mute'}>{checked ? 'On' : 'Off'}</Badge>
    </div>
  );
}
