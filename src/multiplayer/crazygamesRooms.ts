/**
 * Multiplayer on CrazyGames (their build only; elsewhere `startCrazyGamesRooms` returns at once).
 *
 * Their site brings players together itself: an invite button in their own frame, a friends list, and
 * "instant multiplayer" entry points. For that the game has to
 *  - tell their SDK which room the player is in and whether it can be joined (`enterRoom` / `leaveRoom`);
 *  - join the room an invited player was sent to, on arrival and while the game is already open;
 *  - put the player straight into a room of their own when their site asks for instant multiplayer.
 * A room is identified to them by its six-character code, carried as the invite parameter `room`.
 */
import { store } from '../hooks/useAppStore';
import { sanitizeName } from '../net/protocol';
import { normalizeRoomCode } from '../net/roomCode';
import { crazyGames } from '../platform/crazygames';
import { multiplayer } from './client';

/** Players need a name before they can be in a room: their CrazyGames username, or a made-up one. */
export async function ensureName() {
  if (sanitizeName(multiplayer.get().name)) return;
  const username = sanitizeName((await crazyGames.username()) ?? '');
  multiplayer.setName(username ?? `Player${100 + Math.floor(Math.random() * 900)}`);
}

/** Join the room an invite points at (ignored when it has no usable room code, or we are already in it). */
async function joinInvited(params: Record<string, string> | null): Promise<boolean> {
  const code = normalizeRoomCode(params?.room);
  if (!code) return false;
  await ensureName();
  store.go('multiplayer');
  if (multiplayer.get().room?.code !== code) multiplayer.joinRoom(code);
  return true;
}

export async function startCrazyGamesRooms() {
  if (!crazyGames.enabled || !multiplayer.get().available) return;
  if (!(await crazyGames.ready())) return;

  // keep their site in step with the room we are in
  let told = '';
  const report = () => {
    const room = multiplayer.get().room;
    // only rooms made by a player are for inviting friends into; a quick-match room is filled by the server
    const invitable = room && room.kind === 'custom' ? room : null;
    const joinable = !!invitable && invitable.players.length < invitable.settings.maxPlayers;
    const next = invitable ? `${invitable.code}:${joinable}` : '';
    if (next === told) return;
    told = next;
    if (invitable) crazyGames.enterRoom(invitable.code, joinable, { room: invitable.code });
    else crazyGames.leaveRoom();
  };
  multiplayer.subscribe(report);
  report();

  // invited while the game is open (their invite pop-up, or joining a friend)
  crazyGames.onJoinRoom((params) => void joinInvited(params));

  // arrived through an invite link, or their site asked for a room straight away
  if (await joinInvited(crazyGames.inviteParams())) return;
  if (crazyGames.isInstantMultiplayer() && !multiplayer.get().room) {
    await ensureName();
    store.go('multiplayer');
    multiplayer.createRoom();
  }
}
