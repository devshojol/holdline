/**
 * Menu sounds: a soft tick when the pointer reaches a control and a firmer one when it is pressed.
 * They are synthesised here (two short tones) so the menus don't have to load the game's audio engine.
 * Browsers only allow sound after a click or key press, so nothing plays before the first one.
 */

let ctx: AudioContext | null = null;
let lastHover = 0;

function context(create: boolean): AudioContext | null {
  if (ctx || !create) return ctx;
  try {
    ctx = new AudioContext();
  } catch {
    ctx = null;
  }
  return ctx;
}

function tone(ac: AudioContext, freq: number, to: number, duration: number, gain: number, type: OscillatorType) {
  const t = ac.currentTime;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + duration);
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(gain, t + 0.006);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(amp).connect(ac.destination);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

/** `volume`: the master volume setting, 0 to 1. */
export function uiSound(kind: 'hover' | 'click', volume: number) {
  if (volume <= 0) return;
  // a click is a user gesture, so it may start the audio; a hover may only use audio already started
  const ac = context(kind === 'click');
  if (!ac) return;
  if (ac.state === 'suspended') void ac.resume();
  if (kind === 'hover') {
    const now = performance.now();
    if (now - lastHover < 45) return; // sweeping across a row of buttons shouldn't buzz
    lastHover = now;
    tone(ac, 1900, 1500, 0.045, 0.035 * volume, 'sine');
  } else {
    tone(ac, 620, 340, 0.09, 0.11 * volume, 'triangle');
    tone(ac, 1500, 900, 0.05, 0.05 * volume, 'sine');
  }
}
