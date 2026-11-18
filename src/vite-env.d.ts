/// <reference types="vite/client" />

/** True when the build may fetch optional recordings from public/sounds (false for the single-file build). */
declare const __SAMPLE_OVERRIDES__: boolean;
/** True when the build may load the optional 3D models in public/models (false for the single-file build). */
declare const __LOCAL_MODELS__: boolean;

/** True in the build uploaded to CrazyGames (npm run build:crazygames): see vite.config.ts. */
declare const __CRAZYGAMES__: boolean;

interface ImportMetaEnv {
  /** Address of the multiplayer game server, e.g. wss://play.example.com. Unset = multiplayer is off (dev builds use this machine, port 8787). */
  readonly VITE_MP_SERVER?: string;
}
