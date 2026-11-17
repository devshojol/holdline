/**
 * The resume token: proof to the game server that this tab is a player it already knows, so a reload
 * or a dropped connection returns to the same place in the same room. It lives in sessionStorage, so
 * each tab is its own player and closing the tab forgets it.
 */
const RESUME_KEY = 'tal-mp-resume';

export function readResume(): string | undefined {
  try {
    return sessionStorage.getItem(RESUME_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeResume(token: string | null) {
  try {
    if (token) sessionStorage.setItem(RESUME_KEY, token);
    else sessionStorage.removeItem(RESUME_KEY);
  } catch {
    // storage blocked: a reload simply won't rejoin
  }
}
