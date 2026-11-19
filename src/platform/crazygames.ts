/**
 * CrazyGames SDK (v3), used only in the build made for their site (`__CRAZYGAMES__`, npm run build:crazygames),
 * where vite.config.ts adds their script to the page. Everywhere else every call here does nothing.
 *
 * What their site needs from a game:
 *  - when it is loading and when a round is actually being played (no ad is shown during play, and they measure
 *    how many visitors reach gameplay);
 *  - multiplayer: which room the player is in, so their own invite button and friends list can bring others
 *    into it; the room an invited player should join; and "instant multiplayer", where the game should put the
 *    player straight into a room of their own;
 *  - their mute switch, which overrides the game's own volume.
 *
 * Nothing here may throw into the game: with an ad blocker, or outside their site, the SDK may be missing or
 * refuse to start.
 */
type InviteParams = Record<string, string | number>;

interface CrazySdk {
  init(): Promise<void>;
  game: {
    gameplayStart(): void;
    gameplayStop(): void;
    loadingStart(): void;
    loadingStop(): void;
    settings?: { muteAudio?: boolean };
    addSettingsChangeListener?(fn: (settings: { muteAudio?: boolean }) => void): void;
    inviteLink?(params: InviteParams): string;
    showInviteButton?(params: InviteParams): string;
    hideInviteButton?(): void;
    inviteParams?: Record<string, string> | null;
    isInstantMultiplayer?: boolean;
    updateRoom?(room: { roomId?: string; isJoinable?: boolean; inviteParams?: InviteParams }): void;
    leftRoom?(): void;
    addJoinRoomListener?(fn: (params: Record<string, string> | null) => void): void;
  };
  user?: { getUser?(): Promise<{ username?: string } | null> };
}

let starting: Promise<CrazySdk | null> | null = null;
/** The SDK once it has started (null before that, and when there is none). */
let live: CrazySdk | null = null;

function sdk(): Promise<CrazySdk | null> {
  if (!__CRAZYGAMES__ || typeof window === 'undefined') return Promise.resolve(null);
  starting ??= (async () => {
    const found = (window as unknown as { CrazyGames?: { SDK?: CrazySdk } }).CrazyGames?.SDK;
    if (!found) return null;
    try {
      await found.init();
      live = found;
      watchMute(found);
      return found;
    } catch {
      return null;
    }
  })();
  return starting;
}

/** Run `fn` with the SDK once it has started; never throws. */
function call(fn: (s: CrazySdk) => void) {
  void sdk().then((s) => {
    try {
      if (s) fn(s);
    } catch {
      /* the SDK is optional to the game */
    }
  });
}

/** Ask the started SDK for a value now; `fallback` when there is no SDK or it fails. */
function ask<T>(fn: (s: CrazySdk) => T, fallback: T): T {
  if (!live) return fallback;
  try {
    return fn(live);
  } catch {
    return fallback;
  }
}

let playing = false;
let loading = false;

/* ---- their mute switch ---- */
let muted = false;
const muteListeners = new Set<(muted: boolean) => void>();

function setMuted(next: boolean) {
  if (next === muted) return;
  muted = next;
  for (const fn of muteListeners) fn(muted);
}

function watchMute(s: CrazySdk) {
  const read = () => {
    try {
      setMuted(!!s.game.settings?.muteAudio);
    } catch {
      /* no settings on this SDK */
    }
  };
  read();
  try {
    // told of a change; the argument is not relied on, the switch is read again
    s.game.addSettingsChangeListener?.(() => read());
  } catch {
    /* no listener on this SDK */
  }
  // and looked at twice a second, in case their site flips the switch without calling the listener
  window.setInterval(read, 500);
}

export const crazyGames = {
  /** True in the build made for CrazyGames. */
  enabled: __CRAZYGAMES__,
  /** Resolves once the SDK has started (false: there is none, or it would not start). */
  ready: () => sdk().then((s) => s !== null),

  /** The player is in control of a round. */
  gameplayStart() {
    if (playing) return;
    playing = true;
    call((s) => s.game.gameplayStart());
  },
  /** A menu, a pause, the end of a round, or leaving the game page. */
  gameplayStop() {
    if (!playing) return;
    playing = false;
    call((s) => s.game.gameplayStop());
  },
  loadingStart() {
    if (loading) return;
    loading = true;
    call((s) => s.game.loadingStart());
  },
  loadingStop() {
    if (!loading) return;
    loading = false;
    call((s) => s.game.loadingStop());
  },

  /**
   * Their mute switch. `fn` is told the state now and on every change; returns a function that stops that.
   * While muted the game must be silent whatever its own volume settings say.
   */
  onMute(fn: (muted: boolean) => void): () => void {
    muteListeners.add(fn);
    fn(muted);
    void sdk(); // starting the SDK is what reads the switch
    return () => muteListeners.delete(fn);
  },

  /* ---- multiplayer (call after `ready()`) ---- */
  /** What the player was invited with, when they came in through an invite or a friend's room (null otherwise). */
  inviteParams: (): Record<string, string> | null => ask((s) => s.game.inviteParams ?? null, null),
  /** True when their site wants the player put straight into a room of their own. */
  isInstantMultiplayer: (): boolean => ask((s) => !!s.game.isInstantMultiplayer, false),
  /** A link that brings whoever opens it into the game with `params` (null outside CrazyGames). */
  inviteLink: (params: InviteParams): string | null => ask((s) => s.game.inviteLink?.(params) ?? null, null),
  /** The player's CrazyGames username (null when signed out or elsewhere). */
  username: (): Promise<string | null> =>
    sdk().then(async (s) => {
      try {
        return (await s?.user?.getUser?.())?.username ?? null;
      } catch {
        return null;
      }
    }),
  /** The player is in this room: shows their invite button and lets friends join through their site. */
  enterRoom(roomId: string, isJoinable: boolean, params: InviteParams) {
    call((s) => {
      s.game.updateRoom?.({ roomId, isJoinable, inviteParams: params });
      if (isJoinable) s.game.showInviteButton?.(params);
      else s.game.hideInviteButton?.();
    });
  },
  /** The player is no longer in a room. */
  leaveRoom() {
    call((s) => {
      s.game.leftRoom?.();
      s.game.hideInviteButton?.();
    });
  },
  /** `fn` is called when the player accepts an invite or joins a friend while the game is already open. */
  onJoinRoom(fn: (params: Record<string, string> | null) => void) {
    call((s) => s.game.addJoinRoomListener?.(fn));
  },
};
