import { useEffect, useState } from 'react';

/** The screen the menus are laid out for. */
const DESIGN_WIDTH = 1200;
const DESIGN_HEIGHT = 675;
/** Narrower than this is a phone: it gets the stacked layout at its real size (same as `--breakpoint-lg`). */
const PHONE_WIDTH = 768;

function uiScale(): number {
  if (typeof window === 'undefined' || window.innerWidth < PHONE_WIDTH) return 1;
  const fit = Math.min(window.innerWidth / DESIGN_WIDTH, window.innerHeight / DESIGN_HEIGHT);
  return Math.min(2, Math.round(fit * 1000) / 1000);
}

/**
 * How much to scale the menus so the desktop layout fits the window exactly: a window smaller than the
 * design screen (a game frame on a portal, a small laptop) shows the same layout smaller instead of a
 * rearranged or cut-off one, and a bigger one shows it larger. Phones are left alone.
 */
export function useUiScale(): number {
  const [scale, setScale] = useState(uiScale);
  useEffect(() => {
    const update = () => setScale(uiScale());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return scale;
}

