# Holdline

A browser-based 3D aim trainer for tactical shooters. Open it in Chrome, pick a map and a spot to hold, set your sensitivity and crosshair, choose a weapon and fight AI bots that peek, swing, spray and reposition the way real players do. Or play Deathmatch against other people, in a private room with friends or a quick match. No install, no account: practice runs entirely in the page, and multiplayer adds one small game server.

![Holding A Main on Vellora with the Kestrel](docs/screenshots/gameplay.png)

Everything in it is original or freely licensed: the maps, textures, guns, camouflage and gear are made in code, the soldiers' bodies and faces come from MakeHuman (CC0), and the sound recordings are CC0. Sources and licences are at the end and in `public/models/README.md` and `public/sounds/README.md`.

---

## 1. What we're trying to build

Most aim trainers drill clicking on dots. In a real round of a tactical shooter the hard part is different: you hold an angle, an enemy jiggles to bait your shot, shoulder-peeks, swings wide or sprays from a crouch, and you have to react with the right crosshair placement, a counter-strafe and a controlled first bullet. **The goal of Holdline is to recreate those duels** so they can be practised over and over, measured, and improved.

What that means in practice:

- **Bots that play like people.** The bots are the core of the project. They hide behind real cover, peek in different styles (jiggle, shoulder bait, wide swing, crouch spray, ADAD), have human reaction times and aim error, stop before shooting, tap at range and spray up close, run out of bullets and reload, take cover when hurt and re-peek.
- **The game feel has to match.** Look sensitivity is 0.07° per mouse count (a scale several tactical shooters share, so settings carry over), and movement speeds, counter-strafing, first-shot accuracy, running inaccuracy and spray patterns follow the rules of the genre.
- **Real locations.** Eight original maps in the two- and three-site layouts of competitive play, each with practice locations (A Main, Mid, B Long…), attack and defend spawns, and enemy positions that are proven to be peekable.
- **Measurable progress.** Every shot is recorded: accuracy, headshot rate, reaction time, time to kill, first-shot versus spray accuracy, per-weapon results, with a report after each session and charts over days and weeks.
- **Runs anywhere a browser runs.** No download, no anti-cheat, no game client. It can even be built into one self-contained HTML file.
- **Clean assets.** Nothing comes from another game. Geometry, textures, guns and gear are made in code; the soldiers and every recording are CC0.

## 2. Run it

```bash
npm install          # or: bun install
npm run dev          # http://localhost:5173
npm run build        # typecheck + production build into dist/
npm run build:single # one self-contained HTML file in dist-single/ (no models or recordings)
npm run preview      # serve the production build
npm run typecheck    # tsc --noEmit
npm test             # unit and map tests (vitest)
npm run server       # multiplayer game server on port 8787 (see docs/multiplayer.md)
npm run server:build # bundle the game server into dist-server/index.cjs for deployment
```

Headless gameplay smoke tests (Chromium with SwiftShader; Playwright installed globally):

```bash
npm run build && npx vite preview --port 4173 &
node scripts/e2e.mjs http://localhost:4173/ e2e-shots          # movement, aiming, shooting, bots, reload
MAPS='[{"id":"vellora","locations":["a-main","mid","b-main"]}]' \
  node scripts/e2e-maps.mjs http://localhost:4173/ e2e-maps    # every listed map/location peeks correctly
```

### Controls

| Action                                                      | Key                               |
| ----------------------------------------------------------- | --------------------------------- |
| Move                                                        | W A S D (or arrow keys)           |
| Walk                                                        | Shift                             |
| Crouch                                                      | Ctrl or C                         |
| Jump                                                        | Space                             |
| Fire                                                        | Left mouse                        |
| Aim down sights / Monarch scope / 3-round burst (Pilot)  | Right mouse                       |
| Reload                                                      | R                                 |
| Primary / sidearm                                           | 1 / 2, or the mouse wheel to swap |
| Weapon menu (change primary and sidearm mid-session)        | B                                 |
| Pause (in a multiplayer match: menu, the match goes on)     | Esc                               |
| Scoreboard (multiplayer)                                    | Hold Tab                          |

## 3. How it's built

### 3.1 Stack

- **Babylon.js 9** renders the world: camera, PBR and standard materials, shadows, particles, glTF models. It is imported by deep paths (`src/game/rendering/babylon.ts`) so the bundle only contains what is used.
- **TypeScript** everywhere, strict mode.
- **React 19 + Vite 8 + Tailwind CSS 4 + Lucide** for the menus, settings, HUD and reports.
- **Web Audio API** for all sound, with HRTF 3D panning.
- **Pointer Lock API** with `unadjustedMovement` (raw mouse input).
- **localStorage** for settings, crosshair presets and session history.
- **Vitest** for unit and map tests, **Playwright** scripts for in-browser smoke tests.

There are no other runtime dependencies in the browser: physics, AI, navigation, audio synthesis and the map builder are all written for this project. The multiplayer game server is a Node process that uses `ws` for WebSockets and shares the simulation code with the client.

### 3.2 Project layout

```
src/
  app/App.tsx                 shell + navigation
  pages/                      Home, Practice, Maps, Weapons, Crosshair, Sensitivity, Statistics, Settings, Game
  components/                 UI kit, MapPreview (top-down SVG with live field of view), charts, HUD, session report
  hooks/useAppStore.ts        small external store (useSyncExternalStore) with persistence
  services/storage.ts         versioned localStorage with defaults merging
  settings/defaults.ts        default settings, difficulty presets, graphics presets, eDPI / cm-per-360 maths
  types/                      shared interfaces (weapon, bot, map, practice, crosshair, sensitivity, stats, HUD)
  net/                        code shared with the game server: messages, room settings, commands, room codes
  multiplayer/                the browser's connection to the game server, and the lobby and match state
  game/
    engine/GameEngine.ts      the only React↔game boundary: create/start/pause/end/updateSettings + events
    engine/RenderHost.ts      one Babylon engine + canvas reused by every session
    core/Input.ts             keyboard/mouse, pointer lock, raw deltas consumed once per frame
    physics/CollisionWorld.ts AABB world: slab raycasts, kinematic movement, hitboxes
    player/PlayerController   look, run/walk/crouch/jump, counter-strafe friction
    weapons/                  weapon configs + recoil patterns, WeaponSystem, ViewModel, skins, rifle and pistol arms
    bots/                     Bot entity, visuals, behaviours, perception, navigation
    maps/                     grid map definitions, map builder, enemy-spot finder, generated spots
    practice/                 PracticeDirector (modes, spawns, respawns), SessionTracker (stats + scoring)
    rendering/                MapRenderer, procedural textures, pooled effects, glTF helpers
    audio/                    AudioEngine (playback, 3D, recordings) and gunSynth (synthesised gunshots)
    hud/                      crosshair renderer (shared with the editor) and minimap
    net/                      multiplayer in the engine: movement prediction, interpolation of other players
server/                       multiplayer game server (Node): rooms, quick-match queue, matches, test bots
public/
  favicon.svg                 crosshair icon (inlined as a data URI in the single-file build)
  models/                     agent, arms and weapon-skin GLBs with their credits (README.md)
  sounds/                     recordings that replace synthesised sounds (README.md lists the slots)
docs/screenshots/             images used in this README
docs/map-visuals-plan.md      the plan for the next piece of work: realistic map visuals
docs/multiplayer.md           multiplayer: status, running and deploying it, and the design
Dockerfile, render.yaml       the game server's image and its Render service (fly.toml: an unused Fly.io setup)
scripts/                      single-file build, Playwright smoke tests, asset preparation
tests/                        unit and map tests; tests/tools/gen-spots.test.ts regenerates enemy spots
```

### 3.3 The frame loop and the React boundary

React never drives the game. `GameEngine` owns a `requestAnimationFrame` loop:

1. **Mouse look first.** Raw mouse deltas are applied to the camera before anything else, so aiming has the lowest possible latency.
2. **Fixed 120 Hz simulation.** The player, weapons, bots and practice director advance in fixed substeps, so fire rates, movement and AI timing don't depend on the frame rate.
3. **Render.** Babylon draws the scene; the crosshair, hit markers, damage-direction arcs and minimap are drawn every frame onto a 2D overlay canvas.

React only receives throttled HUD snapshots (about 12 per second) and discrete events (kill feed, status changes, session end). The engine and canvas are created once (`RenderHost`) and reused by every session, and compiled shaders are kept (`Effect.PersistentMode`), so only the first session pays the shader-compile cost. A session can be torn down while it's still loading, which keeps React StrictMode's double mount from building two engines.

### 3.4 Player movement and aiming

- `PlayerController` models acceleration and friction rather than instant velocity. Running speed is 5.4 m/s; walking and crouching scale from it. Releasing a key applies a strong counter-strafe friction, so stopping from full speed to "accurate" speed takes under 80 ms (unit test).
- The player is an upright box moved kinematically against the map's merged boxes (`CollisionWorld`): wall sliding, 0.4 m step-up, ground snapping on stairs, and a ceiling check before standing up from a crouch.
- Look turns 0.07° per mouse count at sensitivity 1, with separate horizontal, vertical and ADS multipliers and invert Y. The Sensitivity page converts from other games and shows eDPI and cm/360°.

### 3.5 Weapons

- Eight weapons live in `src/game/weapons/weaponConfigs.ts`. Primaries: Kestrel (9.75 rounds/s, 25 rounds, 160/40/34 head/body/legs at every range), Halcyon (11 rounds/s, 30 rounds, suppressed, damage falls off at 15 m and 30 m), Hornet (suppressed SMG, 13.33 rounds/s, accurate on the move), Arbiter (semi-automatic, 195/65/49) and Monarch (bolt-action sniper, 255/150/120, one shot every 1.67 s, 5 rounds). Sidearms: Pilot (right-click burst), Whisper (suppressed, 15 rounds) and Magnate.
- **The Monarch** is a bolt-action sniper rifle. Right click cycles the scope: 2.5×, 5×, off. After each shot the scope drops while the bolt is worked and comes back by itself at the same zoom (a right click meanwhile cancels that); the last round goes straight into the reload, and reloading or switching weapon leaves the scope. It is only accurate fully scoped and standing still, has no crosshair unscoped, and scoped look speed is divided by the zoom so the picture moves at the same speed at both levels (times the scoped-sensitivity multiplier). The scope is drawn on the 2D overlay.
- `WeaponSystem` handles firing on a carried sub-frame cooldown (so the fire rate is exact at any frame rate), spread (base, crouch, running, in the air, and firing error that grows per shot), hand-authored recoil patterns with recovery, ADS (1.1× to 1.5× by gun), the Monarch's scope levels and bolt cycle, bursts, reloads, auto-reload and equip times.
- Shots are hitscan: a ray from the eye through the spread cone is tested against the world and each bot's hitboxes (head, body, legs, following crouch). The closest hit wins, so walls stop bullets.
- Reload times: Pilot 1.75 s, Whisper 1.5 s, Magnate 2.25 s, Hornet 2.25 s, Arbiter, Halcyon and Kestrel 2.5 s, Monarch 3.7 s. The reload animation and its sound cues last the whole reload, ending as the gun can fire again.
- **Weapon menu.** B pauses the session and opens a menu of every primary and sidearm; picking one swaps it into its slot with a full magazine (`GameEngine.setWeapon`, loading the gun's model on demand), and B again returns to the fight. The choice becomes the default loadout for the next session.
- **Gun models.** All eight guns have their own GLB model (`WeaponSkins.ts`), built in Blender by `tools/blender/make_weapons.py`. Each is placed from grip, handguard, muzzle and sight points measured on the model, so the hands, muzzle flash, tracers and sights line up. Where the model keeps them as separate parts, the magazine comes out on reload and the Monarch's bolt lifts and slides after each shot. The "simple guns" setting and the single-file build use guns built from boxes in `ViewModel.ts`.
- **First-person arms** (Settings → Graphics → First-person arms):
  - _Animated_ (default): an animation pack of gloved arms. `AnimatedArms.ts` evaluates its Draw, Fire, Reload and Reload_Empty clips from game state every frame; the game's gun rides the pack's weapon joint and the magazine follows the pack's magazine joints. The rig is turned so the barrel points at the crosshair, and ADS blends the rig to centre the sights. Sidearms use a second pack (`PistolArms.ts`): the same arms in a two-handed pistol hold with their own draw, shoot and reload clips. Working the Monarch's bolt is a procedural reach of the right hand on top of the rifle clips.
  - _Rigged arms_: a static arm model that `ArmModel.ts` cuts up and skins in code at load (forearm, hand and finger bones), then poses with IK every frame.
  - _Simple_: block hands. The single-file build uses arms built from simple shapes.
- Effects: muzzle flash with a light, tracers (not on the suppressed Halcyon), wall decals, sparks, hit puffs and view kick, all from pooled objects (`rendering/Effects.ts`).

### 3.6 Bots

A bot is one `Bot` entity (state, perception, aim, shooting, movement) plus a _behaviour_ that decides what it wants to do, plus a _visual_.

- **Perception** (`bots/perception/visibility.ts`): a ~130° field of view and line of sight tested with raycasts to seven points on the body (head, both cheeks, chest, both shoulders, legs), so bots can't see or shoot through walls but do spot a shoulder or head poking out. The same code analyses each peek line to find where a bot is hidden and where it becomes visible.
- **Aim model**: a reaction delay after the player becomes visible (650 / 420 / 270 / 175 ms for Easy / Normal / Hard / Radiant), an aim error that starts wide and converges, a head-or-body choice (switching to whichever of the two it can actually see), an aim that trails a moving player by a moment (much longer for weak bots), bursts with pauses so recoil resets, recoil compensation, and a stop before shooting (counter-strafe discipline). Burst length follows range: one or two bullets beyond 28 m, a burst at medium range, a spray inside 9 m. Bots have real magazines and reload when empty. Headshot chance (how often a bot aims for the head; at 0 bots deal no headshot damage) and a bot damage multiplier are set per difficulty and can be changed on the Practice page. Custom sliders cover reaction, accuracy, peek frequency and duration, speed, aggression, burst length and crouch frequency.
- **Peek behaviour** (`behaviors/PeekBehavior.ts`, used in Angle Holding and Jiggle training): a state machine (hidden → prep → out → hold/engage → back, with relocation to another free spot) that plays full peeks, jiggles, shoulder baits, wide swings, crouch sprays and ADAD strafes. A bot with an empty magazine goes back behind cover to reload.
- **Deathmatch behaviour** (`behaviors/DeathmatchBehavior.ts`): patrol → engage → hold or chase → search, with cover and re-peek. In a fight the bot stops to shoot and sidesteps between bursts, closing in when its gun is out of range and backing off when the player is on top of it; it ducks behind cover when hurt or reloading. When the player breaks line of sight it holds the angle or pushes (by aggression), walks the last stretch quietly, follows the way the player was heading and checks the longest lanes before giving up. Careful bots hold an angle on close footsteps; a bot that spots the player alerts roaming bots within 28 m; a bot shot from behind turns on the shooter. Roaming bots look into the next lane before a corner and keep apart from each other. Paths come from grid A\* (`navigation/`) with step heights, drops, corner rules and path smoothing.
- **Weapons and fairness**: each bot draws a gun when it spawns (Practice → Bot weapons: a weighted mix of every gun but the sniper, rifles only, sidearms only, or your own primary) and taps semi-automatic guns in ones and twos. `maxAttackers` limits how many bots may shoot at once (1 / 2 / 3 / no limit for Easy / Normal / Hard / Radiant); the others hold fire until a slot frees up. Bots hold fire for a moment after you respawn (2 s in Deathmatch).
- **Size**: bots are person-sized (1.8 m). One constant, `BOT_SCALE` in `visibility.ts`, scales the model, hitboxes, collision, eye height and visibility checks together; regenerate enemy spots after changing it.
- **Visuals** (`bots/AgentVisual.ts`): by default a rigged agent model, a random one of the agents in `src/game/agents.ts` per bot. It has no animations, so its skeleton is posed in code every frame: a gait whose planted feet match the ground speed, hip bob and sway, a lean into the run, a low combat squat when crouched, aim pitch, both hands IK-solved onto the rifle, a recoil kick per shot, a flinch when hit, a reload with the left hand swapping the magazine, and a fall onto the back on death. Posing is skipped off-screen and runs at a third of the rate far away. Joints are matched by name without the exporter's number suffix, so any agent on the same rig works (`scripts/prepare-agent-model.mjs` prepares one). The fallback is a procedural training dummy.

### 3.7 Maps

- Maps are written as **character grids** (`src/game/maps/<theme>/<map>.ts`) with a small builder (`GridBuilder`): `#` wall, `.` floor, `c`/`C`/`D` low crate, crate and stack, `P` pillar, `r` rail, `=` arch, `w` window, and digits for raised floors. Each cell is 1.5 m (`CELL` in `GridMap.ts`).
- `MapData` turns the grid into **merged boxes** once, and the same boxes feed rendering, collision and navigation, so what you see is what blocks you. Corridors are then dressed deterministically: stepped wall heights, archways and low crates in long corridors (real geometry), and visual-only facade detail (doors, windows, lamps, pilasters).
- Each map declares practice **locations** with attack and defend spawns. Vellora's enemy spots are placed by hand. For the other seven, `spotFinder.ts` scans every cover face and keeps positions where a bot is fully hidden, becomes visible after a short strafe, and stands in front of the player; it tops up the picks until every spawn has at least 3 usable spots (the map test checks this) and stores them in `src/game/maps/generated/*.json`. Regenerate after changing geometry, spawns or bot size:

  ```bash
  GEN_SPOTS=1 npx vitest run tests/tools/gen-spots.test.ts
  ```

| Map        | Setting     | Practice locations                                                     |
| ---------- | ----------- | ---------------------------------------------------------------------- |
| Vellora    | Hill-town piazza   | A Main, Mid, B Main                                                    |
| Dunehold   | Desert bazaar      | A Short (via Baths), A Long, Teahouse (door + window), B Long          |
| Sanctum    | Temple compound    | A Long, A Short, Mid, Workshop, C Long (three sites)                   |
| Kitsune    | Neon back streets  | A Main (under A Balcony), Mid (raised Mid Top), B Main (under B Balcony) |
| Tamarind   | Jungle ruins       | A Main, B Main, C Main over the C Rise (three sites)                   |
| Permafrost | Arctic port        | A Main, Mid (Furnace), B Main into container mazes                     |
| Coralis    | Island fort        | A Main into a huge open site, Mid, B Main through the B Bend           |
| Goldline   | Evening boulevard  | A Main via the A Bend, Mid (Arcade/Courtyard), B Main                  |

### 3.8 Practice modes and statistics

- **Angle Holding**: hold a location while bots peek with the behaviour you pick (or a mix). Bots that peek and escape count against you.
- **Jiggle Peek Training**: bots jiggle, shoulder-bait and then commit; wasted bait shots are tracked.
- **Basic Deathmatch**: up to 10 bots that roam, hunt and respawn.
- **Spray Control**: no bots. Spray at any wall and pull against the recoil. `SprayTrainer` groups shots into sprays (five bullets or more) and scores each from 0 (mouse held still) to 100 (recoil fully cancelled) by how far the centre of the spread cone (aim movement plus recoil pattern) strays from the first-shot point; random spread is plotted but not scored. A panel on the 2D overlay plots the bullets, your control line and the uncontrolled pattern live.

`PracticeDirector` owns the bots, assigns spots (never one whose peek line passes within 6 m of your spawn), handles deaths and respawns. `SessionTracker` records shots, hits by zone, reaction time (bot visible → your first hit), time to kill, first-shot / spray / moving accuracy, kills, deaths, damage, escapes, bait shots and a per-weapon breakdown, and computes a score. Each session ends with a report; history (up to 300 sessions) feeds the Statistics page's daily and weekly charts.

### 3.9 Multiplayer

Deathmatch against other people, up to 10 in a match. Full detail, including how to run and deploy it, is in [`docs/multiplayer.md`](docs/multiplayer.md).

- **Custom rooms**: create a room, invite friends with a 6-character code or a link, and set the map, time limit, kill limit, allowed weapons, respawn delay and more. The host starts the match; afterwards everyone returns to the room with the final score.
- **Quick match**: pick the maps you accept and search. A match starts within 15 seconds (at once with 10 players), filled to six with bots, and later arrivals take a bot's place while the match has time left. Idle players are removed.
- **Bots** (`server/MatchBot.ts`) fill a match so one person can play: they roam, fight whoever they see, including each other, chase for a moment and turn on whoever shoots them, at three difficulties. A custom room can fill to any size.
- **The server decides.** A Node game server (`server/`) owns every room and match. It runs the same `PlayerController`, `CollisionWorld` and hitbox code as the client (the files are shared, and a test fails if any of them touches the browser or Babylon), so a client can't teleport, deal extra damage or score for itself.
- **Movement** is predicted on the client and corrected by the server: each simulation step is sent as a command and replayed there. Other players are drawn 100 ms in the past, blended between snapshots that arrive 30 times a second.
- **Shots** play their effects at once on the shooter's screen. The server checks the gun, fire rate, origin and direction, rewinds the other players to where the shooter saw them (lag compensation), and reports the hit.
- **In a match**: the kill feed, a Tab scoreboard, a match clock, spawn protection, and the minimap shows a player for a moment after they fire an unsuppressed gun. Other players are drawn holding the gun they carry. A kill restocks spare ammunition; guns picked in the weapon menu arrive at the next respawn. The world never pauses.
- **Around a match**: the room shows players as cards with the places bots will take, searching shows a radar, loading shows the map, and the end is a Victory, Defeat or Draw screen with the scoreboard.
- **Try it locally** with `npm run server` and `npm run dev`; `npm run mp:bot -- <room code> 3 shoot` adds test players.

### 3.10 Rendering

- **Seeing enemies at range**: a light distance haze in each map's own pale colour softens far scenery (about a fifth at 45 m), while characters are left out of it and give off a third of their own colour as light. A far enemy stays crisp and saturated against a softened background instead of sinking into it.
- `MapRenderer` batches the merged boxes into a few meshes with world-space UVs, so textures tile evenly at any box size. Wall, floor, crate, metal and stone textures and the sky are drawn procedurally on canvases (`rendering/textures.ts`), seeded per map.
- Graphics presets (Potato / Low / Medium / High) set shadows, resolution scale, anti-aliasing, effects, post-processing, lighting, texture size and which bot, gun and arm models load. Potato is for machines without a dedicated GPU. On first run `settings/deviceProfile.ts` reads the GPU name and picks a preset; Settings shows what it found.
- Adaptive resolution (on by default) lowers the render scale in steps while the frame rate is under 60 (or the FPS limit) and raises it again afterwards, down to half the chosen scale. An FPS limit (30 / 60 / 120 / 144) is available for laptops.
- The game page and Babylon load on demand, so the menus don't download the 3D engine; it is fetched in the background once the page is idle.
- WebGPU can be chosen in Settings and falls back to WebGL 2.
- The minimap is pre-rendered from the grid and rotated so your facing is up; nearby enemies are shown as a training aid (range adjustable).

### 3.11 Audio

- `gunSynth.ts` builds each gunshot from layers (supersonic crack, muzzle blast, body punch, sub thump, mechanical action, early reflections, convolution reverb) and renders 4 variations per weapon with an `OfflineAudioContext`.
- `AudioEngine.ts` plays everything: footsteps, jumps, landings, reload cues, hit and headshot sounds, kill-streak chimes, bullet whizz. Enemy sounds are positioned in 3D (HRTF), muffled with distance and behind walls, and sent to a reverb; enemy gunshots use the same clean sound as your own gun, only panned and slightly quieter with distance.
- Any slot can be replaced by recordings listed in `public/sounds/manifest.json` (see `public/sounds/README.md`). Recordings are trimmed of silence on load, long footstep takes are cut into single steps, and footsteps, reloads and kill sounds play one voice at a time. In this repository all eight guns' shots, footsteps, the reload and kill-streak sounds 1–5 use the owner's recordings. Everything else is synthesised.

### 3.12 UI, settings and storage

- The menus are built as a game's, not a website's: a full-screen shell with a top bar of screens, an animated backdrop, a footer of key hints and tips, and a main menu (Home) with the next drill's map laid out as a tactical table. Menu controls make a soft sound on hover and click (`utils/uiSound.ts`, following the master volume), and Esc returns to the main menu.
- Screens: Home, Practice (map, location, side, spawn, mode, behaviour, bot count, difficulty, weapons), Maps, Weapons, Crosshair (full editor with presets and import/export codes), Sensitivity, Statistics, Settings (graphics, audio, HUD, controls, data), Multiplayer (rooms, quick match) and Game. On Home, **Quick play** goes straight into the quick-match search on any map (the server joins a running quick match that has room, or starts one that bots fill; a build with no game server starts the practice drill instead), and **Custom setup** is practice alone. The menus are laid out for a 1600×900 screen and scaled as a whole to fit the window (`useUiScale` in `app/App.tsx`), so a small frame on a games portal shows the same desktop layout smaller; only windows narrower than 768 px get the stacked phone layout. Soldiers give off a good part of their own colour as light (`SELF_LIGHT` in `bots/AgentVisual.ts`), so they stand out from the scenery at range.
- Settings live in a small external store (`useAppStore`) saved to versioned localStorage keys; stored values are merged with the defaults so new settings appear without wiping old ones.
- Robustness: the game pauses on Esc, pointer-lock loss, window blur or a hidden tab; pointer lock is requested before fullscreen; WebGL context loss and missing WebGL show a clear message; audio starts on the first click; fullscreen uses Keyboard Lock so Ctrl+W doesn't close the tab while crouch-walking.

### 3.13 Builds and assets

- `npm run build` produces `dist/` for any static host (the project deploys to Vercel). Built with `VITE_MP_SERVER` set to the game server's address, the site has multiplayer; without it the Multiplayer page says the mode is unavailable.
- `npm run server:build` bundles the game server into `dist-server/index.cjs`; the `Dockerfile` builds the same into an image. It runs on Render (`render.yaml`).
- `npm run build:single` builds with `vite.single.config.ts` and inlines all JS, CSS and the favicon into one HTML file. That build sets `__LOCAL_MODELS__` to false, so it never loads GLB models or recordings: bots are training dummies, arms are built from shapes and all sounds are synthesised.
- `scripts/compress-models.mjs` shrinks every GLB in a folder (welding, quantized vertex data, trimmed animation keyframes). It simplifies the Halcyon on every run, so point it at a folder holding only the new files rather than at all of `public/models`.
- Models are built in Blender from code: `tools/blender/make_weapons.py` (guns) and `tools/blender/make_bots.py` (soldiers, with the MPFB add-on), run through `tools/blender/bl.py`. `scripts/prepare-fp-arms.mjs` prepares the first-person arms and `scripts/compress-models.mjs` compresses models. Sounds are cut by `tools/audio/make_gun_sounds.py` and `tools/audio/make_foley.py`.

### 3.14 Testing and debugging

- `npm test` checks the collision world, hitboxes, weapons (fire rate at any step size, first-shot accuracy, spray climb, recoil recovery, running inaccuracy and counter-strafe recovery), the Monarch's scope and bolt cycle, sensitivity maths, crosshair codes, the spray trainer, audio clean-up, device detection, bots (magazine and reload, range discipline, aiming at the visible part, a full deathmatch simulation, turning on a shooter) and every map: closed border, spawns in free space on the ground, at least 3 peekable enemy positions per spawn, every callout reachable. Multiplayer is covered too: the message codec, room and queue rules, client prediction against the real server match at several latencies, lag compensation, damage and scoring.
- `scripts/e2e.mjs` and `scripts/e2e-maps.mjs` drive a real browser session.
- In a running game, `window.__TAL__.debug` exposes helpers such as `state()`, `teleport()`, `setView()`, `aimAtBot()`, `hitboxes(true)`, `timeScale()`, `godMode()` and `spectate(botIndex)` (watch a bot from outside to check its animation).

### 3.15 Extending it

- **New map**: add a grid file under `src/game/maps/`, register it in `maps/registry.ts`, declare its locations and spawns, run the spot generator, then `npm test`.
- **New weapon**: add its id to `WeaponId` in `src/types`, a config with stats and a recoil pattern in `weaponConfigs.ts`, and optionally a skin entry in `WeaponSkins.ts` and sound slots in the manifest.
- **New sound**: drop the file in `public/sounds/` and list it under its slot in `manifest.json`.

### 3.16 The CrazyGames build

`npm run build:crazygames` makes the build for crazygames.com in `dist-crazygames/` and zips it as
`holdline-crazygames.zip` (about 17 MB zipped, 36 MB and under 300 files unpacked; their limits are 50 MB and
1,500 files). It differs from the site's build in four ways, all switched by `__CRAZYGAMES__` (see `vite.config.ts`):

- every file is referenced by a relative path, as their site requires;
- their SDK is loaded, and `src/platform/crazygames.ts` tells it when the game is loading and when a round is
  being played;
- the game's own fullscreen is off and its setting hidden (their site has the only fullscreen button allowed);
- their mute switch silences the game whatever its own volume says (`AudioEngine`);
- multiplayer works through their site (`src/multiplayer/crazygamesRooms.ts`): the room a player is in is reported
  to their SDK, which shows their invite button; "Copy invite link" gives their link; a player arriving by an
  invite joins that room; and "instant multiplayer" puts the player straight into a new room. Players are named
  after their CrazyGames username. Lobby size is 2 to 10;
- the multiplayer server's address comes from `.env.crazygames`.

The game server accepts pages on `*.crazygames.com` (`render.yaml`). `npx vite preview --mode crazygames
--outDir dist-crazygames` serves the build locally, where the SDK runs in its "local" mode. There, `?instantJoin=true`
asks for instant multiplayer, `?czy_invite=true&czy_invite_params=room%3DCODE` arrives by invite, and
`?muteAudio=true` mutes. (To try rooms locally, build with `VITE_MP_SERVER=ws://localhost:8787` and run `npm run server`.)

## 4. Known issues and limits

- The animation packs have no ADS or walking animations: ADS moves the whole rig. Rifle reloads were authored for an M4, so on skins without a separate magazine the left hand mimes the change. There is no pistol arms pack: the rifle arms hold the sidearms.
- Bots don't fight each other in Deathmatch, their reloads make no sound, and all their animation is procedural (no motion-captured clips, no ragdoll). The agent model's face, cloth, hair and fingers don't move.
- Navigation is grid A\*, not a Recast navmesh.
- The minimap doesn't show height.
- The Monarch's scope is click-to-cycle only (no hold-to-scope option).
- Statistics are kept in localStorage (300 sessions), not IndexedDB. Multiplayer matches aren't recorded in them.
- Multiplayer: the free game server sleeps when nobody is playing, and Team Deathmatch has no team colours yet. Two people on two machines haven't been tried (testing used bots).
- WebGPU and real-GPU frame rates haven't been measured; automated runs use software rendering. Use the Potato or Low preset on weak machines.
- In a sandboxed iframe Pointer Lock may be blocked; the game falls back to free-mouse aiming. Firefox has no raw pointer input, so OS acceleration may apply.

## 5. What we can do next

**Next up: realistic map visuals.** The maps are still flat-shaded boxes with procedural textures. The plan for giving them real architecture and props, in phases that each ship on their own, is in [`docs/map-visuals-plan.md`](docs/map-visuals-plan.md).

**Training content (most value for players)**

- **Spray transfer**: extend Spray Control with transfers between two or three targets.
- **Counter-strafe trainer**: shows your speed at the moment of each shot and scores how often you fired while accurate.
- **Flick and micro-adjust drills** on the same maps, plus a crosshair-placement score (how far you had to move to the bot's head when it appeared).
- **Scenario packs**: retake and post-plant setups with several bots peeking in sequence, off-angles, and bots that peek together.
- **Daily routine and goals**: a short warm-up playlist, personal bests and targets ("reaction under 250 ms", "60% first-shot headshots").

**Bots**

- Per-bot personalities, and bot models that show the gun they carry.
- Bots that fight each other in Deathmatch, use sound to rotate, and fake peeks with footsteps.
- Real animation clips (walk, run, strafe, crouch, reload) and ragdolls on death; audible bot reloads.

**Weapons and maps**

- A hold-to-scope option for the Monarch; magazines that drop out on reload for every gun skin.

**Technology**

- Profile on real GPUs, test WebGPU, and tune the presets.
- Load Babylon in smaller chunks for a faster first start; make the app an installable PWA that works offline.
- Recast navmesh for smoother bot movement.

**Multiplayer** (see `docs/multiplayer.md`)

- Team Deathmatch on the client (team colours, teammates on the minimap) and locking the guns a room doesn't allow.
- Smarter multiplayer bots: they don't yet hold angles or peek the way the practice bots do.
- A game server that doesn't sleep: the free one takes about a minute to wake after a quiet spell.

## 6. Credits

Details, links and licences are in `public/models/README.md` and `public/sounds/README.md`.

- **Soldiers:** bodies, faces, hair, clothes and boots generated with MPFB, the MakeHuman add-on for Blender, from the "MakeHuman system assets" pack (CC0). Camouflage, vest, pouches, pads and headgear are original.
- **Guns:** original models, built from code in Blender.
- **First-person arms:** "M4 - FPS Weapon Animations Pack (v.1)" by BarcodeGames and "First-Person Arm & Hand - Fingerless Gloves" by Exactly, both CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).
- **Gunshots:** the Freesound pack "Real Gun Sounds" by areniporgen (CC0).
- **Footsteps, reloads, handling, hits and kills:** CC0 recordings from opengameart.org, listed in `public/sounds/README.md`.
- Everything else (maps, textures, the fallback guns and bots, synthesised sounds and the code) is original to this project.
