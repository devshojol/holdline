/**
 * Sidearm hold shared by both arm styles (AnimatedArms and FirstPersonArms via ViewModel).
 *
 * The arm poses were authored on a rifle's long grip, where the palm sits well below the grip point.
 * A pistol grip is short, so the hold is raised (metres, gun space) or the hands end up under the gun.
 * Kept in its own file so ViewModel doesn't pull the animated-arms code into builds that don't use it.
 */
// 0.05 suited the earlier pistol models, whose grip point was near the top of the grip. Ours give the middle of
// the grip, and with 0.05 the hand closed round the frame above the grip, leaving the grip hanging out below it.
export const PISTOL_HOLD_UP = 0.008;
export const PISTOL_HOLD_FWD = 0;
