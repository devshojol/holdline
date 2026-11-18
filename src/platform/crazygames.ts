/**
 * CrazyGames SDK (v3), used only in the build made for their site (`__CRAZYGAMES__`, npm run build:crazygames),
 * where vite.config.ts adds their script to the page. Everywhere else these calls do nothing.
 *
 * Their site needs to know when the player is actually playing (it never shows an ad during play, and measures
 * how many visitors reach gameplay) and when the game is loading. Nothing here may throw into the game: with an
 * ad blocker, or outside their site, the SDK may be missing or refuse to start.
 */
interface CrazySdk {
  init(): Promise<void>;
  game: { gameplayStart(): void; gameplayStop(): void; loadingStart(): void; loadingStop(): void };
}

let ready: Promise<CrazySdk | null> | null = null;

function sdk(): Promise<CrazySdk | null> {
  if (!__CRAZYGAMES__ || typeof window === 'undefined') return Promise.resolve(null);
  ready ??= (async () => {
    const found = (window as unknown as { CrazyGames?: { SDK?: CrazySdk } }).CrazyGames?.SDK;
    if (!found) return null;
    try {
      await found.init();
      return found;
    } catch {
      return null;
    }
  })();
  return ready;
}

function call(fn: (s: CrazySdk) => void) {
  void sdk().then((s) => {
    try {
      if (s) fn(s);
    } catch {
      /* the SDK is optional to the game */
    }
  });
}

let playing = false;
let loading = false;

export const crazyGames = {
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
};
