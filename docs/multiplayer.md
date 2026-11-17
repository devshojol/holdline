# Multiplayer

Players can fight each other in Deathmatch, two ways:

- **Custom**: create a room, invite up to 9 friends (10 players in all) by code or link, pick the map,
  the time and the rules, and start when you like.
- **Quick match**: pick the maps you are happy to play, wait, and a match forms by itself or you join
  one already under way.

It is live: the website at https://valorantaimlab.vercel.app talks to a game server at
`wss://tactical-aim-lab-server.onrender.com`.

This document has three parts: where things stand, how to run and deploy it, and then the design
(sections 1 to 11), which was written before the build and is kept as the explanation of how it works.

## Status

Phases 0 to 5 and 7 of the [build order](#10-build-order) are built. Both modes can be played from start
to finish, with combat decided by the server, and bots fill a match so one person can play.

Not built yet:

- **Team Deathmatch on the client** (phase 6). The server already keeps teams, spares teammates and adds
  up team kills, but the game shows no team colours.
- **Weapon rules on the client** (phase 6). The server ignores shots from a gun the room doesn't allow,
  but the weapon menu doesn't lock those guns.

Where the build differs from the design:

| Design                                                        | Built                                                                                         |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Bots in a match are the practice bots, taught to fight many   | A new, plainer bot plays as a server-side player ([section 9](#9-bots-in-multiplayer))        |
| Quick match starts with 2 players                             | It starts with 1: bots fill the match to 6 and step out as people join                        |
| Reserve ammunition is fixed per life                          | A kill restocks the spare ammunition                                                          |
| The server validates ammo                                     | It checks the gun, fire rate, origin and direction, but does not count the magazine           |
| The server works out run speed from the weapon state          | The client sends the multiplier; the server holds it to what the player's two guns allow      |
| Enemies show on the minimap while a teammate can see them     | Any player shows for 2.5 seconds after firing an unsuppressed gun, and not otherwise          |
| Quick match avoids the map last played                        | It picks at random among the maps most players accept                                         |
| Names are filtered against a word list                        | Names are trimmed, length-limited and made unique in a room                                   |
| Enemies out of sight could be withheld from clients           | Every player's position is sent to every player                                               |
| The first input format repeats recent commands                | Nothing is repeated: a WebSocket delivers everything in order                                 |

Not yet tried: two people playing each other from two machines (every opponent in testing was a bot or a
scripted player),
the first connection after the server has slept, and more than one match at a time on the free server.

## Running it locally

```bash
npm run server       # the game server, on port 8787 (PORT=… to change)
npm run dev          # the app; in development it connects to port 8787 on the same machine
```

Open the app in two tabs (each tab is its own player), go to Multiplayer, create a room in one and open
its invite link in the other. A browser only runs the game in the tab you are looking at, so to see
other players move without a second person, add headless bot players:

```bash
npm run mp:bot -- K7M2QX 3         # three bots join room K7M2QX and run around once the match starts
npm run mp:bot -- K7M2QX 6 shoot   # six that also stop and shoot at anyone they see (poor shots, on purpose)
npm run mp:bot -- quick 3 shoot    # three that search for a quick match instead, and again after each one
npm run mp:bot -- quick 50 shoot   # a load test: fifty bots fill five matches
```

In a match, `window.__TAL__.debug` has:

| Helper                    | What it does                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| `net()`                   | Snapshot count, commands in flight, prediction corrections, where other players are drawn |
| `netLag(ms, jitter)`      | Adds delay to the connection                                                              |
| `netDrop()`               | Cuts the connection, which then reconnects by itself                                      |
| `spectateRemote(index)`   | Watches another player from outside (`null` to return)                                    |
| `aimAtRemote(index)`      | Points the camera at another player                                                       |

## Deploying

The website and the game server are deployed separately. Both redeploy on every push to `main`.

### The game server

One Node process. `npm run server:build` bundles it and everything it shares with the client into a
single file, `dist-server/index.cjs`, which runs with nothing else installed (`npm run server:start`,
Node 20 or newer). The `Dockerfile` builds an image that does the same: bun installs the dependencies
from `bun.lock`, and the 67 MB result runs on Node.

| Setting            | Meaning                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| `PORT`             | Port to listen on (default 8787).                                                                     |
| `ALLOWED_ORIGINS`  | Comma-separated sites whose pages may connect. Unset = any site. Set it in production.                |
| `MAX_PER_ADDRESS`  | Connections allowed from one address (default 20).                                                    |
| `CLIENT_IP_HEADER` | Behind a host's proxy: the request headers carrying the visitor's address, most trusted first. Without it every player counts as the proxy's one address. Only set it when a trusted proxy fills the header. |

What a host must provide:

- **A long-lived process with WebSockets.** Not a serverless function.
- **Exactly one instance.** Rooms live in the process's memory, so two instances would be two separate
  worlds whose players could not find each other's rooms.
- **TLS.** A page served over `https` may only open `wss://` connections.
- **A health check.** Any plain HTTP request to the server answers with JSON: rooms, players, players
  searching, memory, and the last five seconds' tick time, traffic and message rate.

A restart or a deploy ends every match in progress: clients are told at once and return to the
Multiplayer page.

### On Render (in use)

`render.yaml` defines the service: built from the `Dockerfile`, free plan, Singapore, restricted to the
live site's three Vercel addresses. It was created in Render with New → Blueprint → this repository.
Its health page is https://tactical-aim-lab-server.onrender.com/.

What the free plan means:

- **It sleeps after 15 minutes with no traffic** and takes about a minute to wake. An open game
  connection counts as traffic, so it sleeps only when nobody is playing. The first player afterwards
  waits; the client keeps trying for about a minute and a half before giving up.
- **Render may restart a free service at any time**, which ends a match in progress.
- **It is small** (reported as 512 MB and 0.1 CPU). One six-player match ran at 0.3 ms a tick in 68 MB.
- **750 instance hours a month**, which covers one service.

Render's proxy hides visitors' addresses, so `CLIENT_IP_HEADER` lists the headers that carry them. The
health page's `addressSource` shows which one the latest connection used (on Render, `cf-connecting-ip`);
`none` after a player has connected would mean every player is being counted as one address.

A page on `localhost` is refused by the deployed server, so local development uses a local server. To
send test bots at the deployed one:

```bash
MP_SERVER=wss://tactical-aim-lab-server.onrender.com MP_ORIGIN=https://valorantaimlab.vercel.app npm run mp:bot -- quick 3 shoot
```

### The website

The site is built with `VITE_MP_SERVER` set to the server's address; on Vercel this is the project's
production environment variable. Without it the Multiplayer page says the mode is unavailable. After
changing it, the site has to be rebuilt for the new address to take effect.

### On Fly.io (not in use)

The server was first deployed to Fly.io as the app `tactical-aim-lab-server` in Singapore. It worked,
but **a Fly account on its trial stops every machine after 5 minutes** until a card is added
(https://fly.io/trial), so the server moved to Render. The app still exists, stopped, and `fly.toml`
holds its settings: one always-on machine that is never stopped or doubled, HTTPS, the health check and
`CLIENT_IP_HEADER`. With a card on the account it can be brought back:

```bash
fly deploy --ha=false                                  # deploy the current code
fly status                                             # one machine, "1 total, 1 passing"
fly logs                                               # the server's output
fly secrets set ALLOWED_ORIGINS=https://a.example,https://b.example   # which sites may connect
fly apps destroy tactical-aim-lab-server               # or remove the app for good
```

Setting it up from nothing, on another account or under another name:

```bash
fly auth login
fly launch --copy-config --no-deploy --ha=false --name YOUR-APP --region sin
fly secrets set --stage ALLOWED_ORIGINS=https://your-site.example
fly deploy --ha=false
fly ips allocate-v4 --shared && fly ips allocate-v6    # if the first deploy could not provision addresses
fly scale count 1                                      # make sure there is exactly one machine
```

### Load

Measured on a development laptop with `npm run mp:bot -- quick N shoot`, the bots in a second process on
the same machine:

| Matches × players | Tick time (average / worst) | Server CPU      | Memory | Sent per player |
| ----------------- | --------------------------- | --------------- | ------ | --------------- |
| 5 × 10            | 2.0 ms / 6 ms               | 14% of one core | 135 MB | 22 KB/s         |
| 10 × 10           | 3.6 ms / 12 ms              | 37% of one core | 150 MB | 22 KB/s         |

A tick has 33 ms to finish. Bandwidth is the cost to watch: 100 players is about 2.2 MB/s out. These are
bots on one machine with no real network between them, on hardware much faster than the free server.

---

# Design

Written before the build. Where the build went another way, the table under [Status](#status) says so.

## 1. Where we started

Before multiplayer, the game was a static site with no server (it deploys to Vercel, and can even be one
HTML file), and everything was single-player:

- `GameEngine` runs one local player against bots owned by `PracticeDirector`. It takes a
  `PracticeConfig` and has no idea other humans exist.
- Shots are hitscan and resolved locally: `resolvePlayerShot` raycasts against the map and each bot's
  hitboxes; `resolveBotShot` does the reverse.
- Bots are built to fight exactly one player (`BotContext.player`) and don't fight each other.
- The session pauses on Esc, on the weapon menu (B), when the tab loses focus or pointer lock.
- There are no accounts. Settings and statistics live in localStorage.

What helps us:

- The simulation is already separate from rendering. `CollisionWorld`, `PlayerController`,
  `WeaponSystem`, `weaponConfigs`, `MapData`, the hitbox raycast (`rayHumanoid`) and the visibility code
  import nothing from Babylon or the DOM, and the unit tests already run them in Node. **A server can run
  the same code the client runs.**
- Maps are deterministic: the same grid produces the same merged boxes on every machine, so client and
  server agree on collision without sending geometry.
- `WeaponSystem.rng` is injectable, enemy gunshots and footsteps are already positioned in 3D, the agent
  model can already be posed from a position, a yaw, a crouch amount and a speed, and Deathmatch already
  has a spawn picker that avoids enemy sight lines (`dmSpawnPoint`).

## 2. What the player sees

### 2.1 Entry point

A new **Multiplayer** item in the navigation, next to Practice. The page is an agent select beside two modes, Quick match
and Custom room. The name is the only identity: it is stored in localStorage with a random player id. No
account, no password. It is asked for once, the first time the page is opened (a "Choose your callsign"
prompt in place of the screen), shown from then on in the player's tag at the top of the page, and changed
in Settings → Profile. A change is sent to the server at once outside a room; a room keeps the name the
player joined with.

Crosshair, sensitivity, graphics, audio and loadout come from the existing settings, unchanged.

**Agent.** On that page, and again in a room's lobby, the player picks one of nine agents
(`src/game/agents.ts`), each a rigged model in `public/models` (credits in its README) with a profile picture
rendered from it (`scripts/agent-portraits.mjs`), shown in the picker, the player's tag and the lobby's player cards. It is cosmetic only and
remembered in localStorage. In a match every other player is drawn as their agent's model (`AgentVisual`), loaded
the first time someone plays that agent; until it has loaded, or with models off, the built-in body (`BotVisual`)
stands in, in the agent's colours. Either holds the gun they really carry. A change made during a match shows
from the next one. Server bots get a random agent, a different one each while any are free; practice bots each
wear one of three agents picked at random for the session.

### 2.2 Custom room

```
Create room ──► Lobby (code + link) ──► Host presses Start ──► Countdown 5 s ──► Match ──► Scoreboard ──► Lobby
Join by code or link ──┘
```

1. **Create.** The player presses Create room and lands in a lobby as the host. The room gets a
   6-character code (letters and digits without 0/O/1/I) and a link, `…/?room=K7M2QX`.
2. **Invite.** The lobby shows the code, a Copy link button, and the player list (10 slots). Friends open
   the link, or type the code under Join room. Opening the link with no name set asks for one first.
3. **Set up.** The host edits the settings in [section 3.2](#32-custom-room-settings). Everyone else sees
   them change live, read-only. The map panel reuses `MapPreview`.
4. **Ready.** Each player has a Ready toggle. It is information for the host, not a gate: the host can
   start with players not ready.
5. **Start.** Start is enabled with 2 or more players. A 5-second countdown locks the settings, everyone
   loads the map, and the match begins when the countdown ends (players still loading spawn when they
   finish).
6. **End.** The scoreboard shows for 15 seconds, then everyone returns to the same lobby with the same
   settings, so a rematch is one click.

Host powers: change settings, start, end the match early, kick a player, hand the host role to someone
else. If the host leaves, the player who has been in the room longest becomes host. A host whose
connection drops keeps the role for the 30 seconds their place is held, so a reload doesn't hand the room
to someone else. The room closes when
the last player leaves, or after 10 minutes with nobody connected.

Rooms are private: there is no room browser. The code is the only way in.

### 2.3 Quick match

```
Pick a map (or Any) ──► Searching… ──► Match found ──► Countdown 5 s ──► Match ──► Scoreboard ──► Play again / Leave
```

1. The player picks one map, several, or **Any map**, and presses Find match.
2. The searching screen shows the elapsed time, how many players are waiting on that map, and a Cancel
   button.
3. The server places the player by the rules in [section 4](#4-quick-match-matchmaking): into a match
   that is already running and has room, or into a new match once enough players are waiting.
4. Quick match rules are fixed (section 3.1), so every quick match plays the same way.
5. After the scoreboard, Play again puts the player back in the queue with the same map choice.

Players can leave a quick match at any time without penalty; their slot is opened for someone else.

## 3. Game rules

### 3.1 Modes

| Mode                  | What it is                                                                       | Available in         |
| --------------------- | -------------------------------------------------------------------------------- | -------------------- |
| **Deathmatch**        | Free for all. Everyone respawns. Most kills when time runs out, or first to the kill limit. | Quick match, Custom |
| **Team Deathmatch**   | Two teams of up to 5. Team kills are added up; same end conditions.              | Custom               |

Deathmatch is the first mode because the game already has it: respawns, a spawn picker and a scoreboard
all exist for the bot version. Round-based modes (plant/defuse, 1v1 duels) are a later step and not part
of this design.

Rules that apply to both:

- **Health** 100 with 50 armour, as in practice. Weapon damage comes straight from `weaponConfigs`; the
  bot damage multiplier and headshot-chance settings do not apply to humans.
- **Respawn** 3 seconds after death, at a point far from every enemy and out of their sight (the
  existing `dmSpawnPoint` test, run against all enemies instead of one player). In Team Deathmatch the
  point is also biased towards teammates.
- **Spawn protection** for 2 seconds. It ends early the moment the player fires.
- **Loadout.** B opens the weapon menu without pausing. A change applies at the next respawn, or at once
  while spawn protection is active.
- **No pause.** Esc opens the menu (settings, leave match) while the match carries on. Losing focus or
  pointer lock leaves the player standing in the world.
- **Minimap.** Teammates always show. An enemy shows only while a teammate (or you) can see them, or for
  a moment when they fire an unsuppressed gun. The practice-mode "show nearby enemies" aid is off.
- **Kill feed and scoreboard.** The kill feed shows killer, weapon, headshot and victim. Tab holds the
  scoreboard open: name, kills, deaths, assists, headshot %, ping.

**Quick match rules (fixed):** Deathmatch, 10 minutes, first to 40 kills, all weapons, 10 players.

### 3.2 Custom room settings

| Setting             | Options                                                                 | Default     |
| ------------------- | ----------------------------------------------------------------------- | ----------- |
| Map                 | Any of the 8 maps                                                       | Vellora     |
| Mode                | Deathmatch, Team Deathmatch                                             | Deathmatch  |
| Time limit          | 5, 10, 15, 20, 30 minutes                                               | 10 minutes  |
| Kill limit          | Off, 20, 30, 40, 50, 75, 100                                            | 40          |
| Max players         | 2 to 10                                                                 | 10          |
| Weapons             | All, Rifles only, Sidearms only, No Operator, one chosen gun for everyone | All       |
| Headshots only      | On / off (body and leg hits deal no damage)                             | Off         |
| Infinite ammo       | On / off (no reserve limit; reloads still happen)                       | Off         |
| Respawn delay       | 1, 3, 5 seconds                                                         | 3 seconds   |
| Spawn protection    | Off, 2, 4 seconds                                                       | 2 seconds   |
| Join in progress    | On / off (may friends join after the match has started)                 | On          |
| Teams (Team DM)     | Players pick a side in the lobby; host can move players; Auto-balance button | Auto   |
| Friendly fire (Team DM) | On / off                                                            | Off         |
| Bots                | Off, or fill the match to 2, 4, 6, 8 or 10 players; Easy, Normal or Hard | Off         |

With bots on, the host can start a match alone. Bots take the empty places up to the fill number and
step out, lowest scorer first, as people join ([section 9](#9-bots-in-multiplayer)).

## 4. Quick match matchmaking

One queue, with each waiting player carrying the set of maps they accept. A match is a room like any
other, created by the server instead of by a host.

The server looks at the queue once a second and, for each waiting player in order of arrival:

1. **Join a running match.** If a quick match on an accepted map has a free slot and more than 3 minutes
   or 10 kills left, the player joins it. This is what keeps waits short when few people are online.
2. **Start a new match.** Otherwise the player waits. When 10 players accept a common map, the match
   starts immediately. As soon as **1** does (bots will fill the rest), a 15-second timer starts for that group; anyone who arrives
   meanwhile is added, and the match starts when the timer ends. It then stays open to newcomers under
   rule 1.
3. **Any map.** A player who chose Any map goes wherever rule 1 or 2 is satisfied first. When a new match
   is formed from players who all chose Any, the map is picked at random, avoiding the one they last
   played.

A player who has waited 60 seconds alone is told nobody else is searching and is offered Any map (if they
picked one map) or a custom room.

Quick match keeps a few extra rules that custom rooms don't need: a player who sends no input for 60
seconds is removed, and a player who drops is held for 30 seconds before the slot is given away.

There is no skill rating at first. It needs accounts and a population large enough to split; both come
later if the mode is used.

## 5. Architecture

### 5.1 Overview

```
 Browser (existing app)                          Game server (new, Node/Bun, one process)
┌──────────────────────────────┐   WebSocket   ┌────────────────────────────────────────┐
│ React: Multiplayer page,     │◄─────────────►│ Lobby: rooms, codes, host, settings     │
│ lobby, scoreboard            │  lobby msgs   │ Matchmaker: quick-match queue           │
│                              │               │                                        │
│ GameEngine                   │  inputs  ──►  │ Match (one per room):                   │
│  ├ local player: predicted   │               │  ├ PlayerController per player  ┐ same  │
│  ├ remote players: puppets   │  ◄── snapshots│  ├ CollisionWorld / MapData     │ code  │
│  └ NetClient                 │  ◄── events   │  ├ hit resolution (rayHumanoid) ┘ as    │
│                              │               │  └ rules: score, respawn, end     client│
└──────────────────────────────┘               └────────────────────────────────────────┘
        static host (Vercel)                         a host that keeps processes alive
```

**The server is authoritative.** It owns every player's position, health, score and the clock. Clients
send what the player pressed and where they aimed; the server decides what happened. This is what makes
quick matches with strangers workable: a modified client can't teleport, deal extra damage or award
itself kills. It also means there is no "host advantage" and a room survives its host leaving.

The alternative, peer-to-peer over WebRTC with one player's browser acting as the server, needs no
hosting but fails for this feature: the host can cheat freely, a host closing the tab ends the match for
10 people, many home networks can't connect to each other without a relay server anyway, and a browser
tab in the background is throttled to about one update per second.

### 5.2 Why a separate server

Vercel serves the static site and short-lived functions; it cannot keep a process with open sockets and
a running game loop. The game server is therefore a second deployable, a small Node or Bun process on
any host that runs long-lived processes (Fly.io, Railway, Render, a VPS). One process holds every room in
memory; there is no database, because nothing outlives a room.

Rough size: a match is 10 players stepped on demand and one snapshot loop, with raycasts against a few
hundred boxes. One small instance should carry dozens of matches; this is to be measured, not assumed.

The static site learns the server address from a build-time variable. When the variable is missing (the
single-file build, a fork with no server) the Multiplayer page explains that multiplayer is unavailable
and the rest of the app works as it does today.

### 5.3 Shared code

```
src/game/          client; the simulation files below are imported by both sides
  physics/CollisionWorld.ts   ┐
  player/PlayerController.ts  │
  weapons/WeaponSystem.ts     │  shared simulation: no Babylon, no DOM
  weapons/weaponConfigs.ts    │
  maps/ (MapData, registry)   │
  bots/perception/visibility  ┘
src/net/           shared: message types, encode/decode, room settings, commands, room codes
src/multiplayer/   client: the connection and the state the lobby renders from
src/game/net/      client: Prediction, Interpolation (remote players, server clock), NetLink
server/            Lobby.ts (rooms), Match.ts (bodies, commands, snapshots), index.ts (sockets),
                   tools/bot.ts (headless test players); to come: matchmaker, lag compensation, combat
```

Two small changes make the shared files usable on the server:

- `PlayerController.update` and `WeaponSystem.update` take a narrow interface (`ActionSource`:
  `isDown(action)`, `consume(action)`) instead of the browser's `Input` class. `Input` implements it from
  the keyboard and mouse; `CommandInput` implements it from a received command.
- `tests/shared.test.ts` fails if any shared file, or anything it imports, pulls in a package or touches a
  browser global. The server is also typechecked without the browser's type library (`tsc -p server`).

## 6. Netcode

### 6.1 Rates

| What                        | Rate                                  |
| --------------------------- | ------------------------------------- |
| Client simulation           | up to 120 steps per second (as today) |
| Client → server input packets | 60 per second, each carrying the commands since the last one |
| Server → client snapshots   | 30 per second                         |
| Remote players drawn        | 100 ms in the past (interpolated)     |

### 6.2 Your own movement: prediction and correction

Waiting for the server before moving would make every key press feel late by the round trip. Instead:

1. Each simulation step the client records a **command**: sequence number, the step's duration, the
   movement keys held, the view yaw and pitch, and the run-speed multiplier of the weapon in hand (the
   server clamps it to the real range; from phase 3 it works it out itself from the weapon state). It applies the command to its own `PlayerController` immediately,
   exactly as now, and keeps it in a buffer.
2. Commands are sent 60 times a second, each packet carrying the ones gathered since the last. A
   WebSocket delivers everything in order, so nothing is repeated; that changes if the transport ever
   becomes an unreliable one.
3. The server runs each command through the same `PlayerController` code against the same collision
   world, in order.
4. Every snapshot tells the client its authoritative position and the last command the server applied.
   The client rewinds to that position and replays the commands the server hasn't seen yet. Normally the
   result equals what the client already shows, and nothing visible happens. When it differs (the server
   moved you: a respawn, a rejected move), the client blends to the corrected position over about 100 ms
   instead of snapping.

The client's step length varies with frame rate (`GameEngine.frame` splits each frame into steps of at
most 1/120 s), so every command carries its own duration. The server clamps each duration and keeps a
per-player time budget: a client can't move faster by claiming more time than has really passed.

Mouse look stays exactly as it is, applied on the frame it happens. The server never corrects the view
direction, so aiming latency in multiplayer is the same as in practice.

### 6.3 Other players: interpolation

Snapshots arrive 30 times a second and unevenly. The client keeps the last few and draws every other
player where they were 100 ms ago, blending between the two snapshots around that moment (position, yaw,
pitch, crouch, speed). Movement looks smooth, and one lost snapshot is hidden.

A remote player is drawn with the existing agent model (`AgentVisual`), which already builds its gait,
crouch, aim pitch, recoil kick, reload and death fall from exactly those values. The gun shown should be
the one the player holds, which is a known limit of the bot visuals today (they always show the Vandal).

### 6.4 Shooting: who decides a hit

Shots stay hitscan. The client keeps the full `WeaponSystem` feel (fire rate, spread, recoil, ADS, the
Operator's scope) and everything the shooter sees and hears happens immediately: sound, muzzle flash,
tracer, wall impact.

1. The client sends a **shot**: weapon, the command it was fired on, the eye position, the final
   direction (after spread and recoil), and the time of the snapshot pair it was looking at.
2. The server **validates** it: the player is alive, the weapon is one they hold and is allowed by the
   room, the fire rate and magazine are respected, the eye position is within a small distance of where
   the server has the player, and the direction is within the weapon's largest possible spread and recoil
   of the view direction.
3. The server **rewinds** the other players to where they were at the time the shooter saw (it keeps
   about 1 second of positions per player), raycasts the map and their hitboxes with `rayHumanoid`, and
   applies damage from `weaponConfigs`.
4. The server sends the result: a hit confirmation to the shooter (hit marker, hit sound, kill sound),
   damage with direction to the victim, and the shot itself to everyone else for sound and tracer.

Step 3 is **lag compensation**: without it, a player with 80 ms of latency would have to aim ahead of a
moving target. With it, what you saw is what you hit. The cost is the familiar one: occasionally a player
is hit just after reaching cover on their own screen. The rewind is capped at the 100 ms interpolation
delay plus 200 ms of connection delay, so a very poor connection can't shoot far into the past.

Hit markers and kill sounds wait for the server's confirmation (one round trip). Blood puffs on the
target can be drawn at once as a guess; a marker that appeared and was then denied would feel worse than
one that arrives 50 ms late.

A possible later step: make the spread a function of a seed the server also knows, so the server
computes the direction itself rather than checking the client's.

### 6.5 Messages

Lobby and match messages share one WebSocket. All messages go through one encode/decode module in
`src/net/`. Messages are JSON. Snapshots and inputs, which are nearly all of the traffic, are packed into arrays
instead of objects with a name for every number (about 40% smaller); the module can move them to a binary
layout later without touching the rest.

| Direction | Message          | Content                                                                 |
| --------- | ---------------- | ----------------------------------------------------------------------- |
| C → S     | `hello`          | protocol version, name, resume token if reconnecting                    |
| C → S     | `room.create` / `room.join` / `room.leave` | room code where needed                        |
| C → S     | `room.settings` / `room.kick` / `room.host` / `room.start` / `room.end` | host only        |
| C → S     | `room.ready` / `room.team` / `loadout` / `agent` | the player's own state                  |
| C → S     | `queue.join` / `queue.leave` | accepted maps                                               |
| S → C     | `room.state`     | code, settings, players (name, ready, team, host, ping, agent), phase   |
| S → C     | `queue.state`    | waiting count, timer                                                    |
| S → C     | `match.start`    | map, settings, your spawn, server clock, end time                       |
| C → S     | `input`          | the last few commands                                                   |
| C → S     | `shot`           | as in 6.4                                                               |
| S → C     | `snapshot`       | server time, last applied command, your state, every other player's state |
| S → C     | `event`          | shot, hit, damage, kill, respawn                                        |
| S → C     | `match.end`      | final scoreboard                                                        |
| both      | `ping` / `pong`  | latency and clock offset                                                |
| S → C     | `error`          | room not found, room full, kicked, version mismatch                     |

A client whose protocol version doesn't match the server's is asked to reload the page.

### 6.6 Joining late, dropping, reconnecting

- **Join in progress** is the normal path, not a special one: `match.start` carries the current clock and
  the next snapshot carries everyone's state.
- **Dropped connection.** The server keeps the player's slot and score for 30 seconds (their body is
  removed). The client reconnects with its resume token and returns to the match. After 30 seconds the
  slot is free; in a custom room the player can still rejoin with the code and starts from zero.
- **Slow load.** A player still loading the map when the countdown ends simply spawns late.
- **Server restart.** Rooms are lost. Clients show "Connection to the server was lost" and return to the
  Multiplayer page.

## 7. Client changes

- **`GameEngine`** gains a second kind of session. Today it is given a `PracticeConfig` and creates a
  `PracticeDirector`. The parts that differ are put behind one interface (who the targets are, what
  happens on a shot, on a death, when the session ends), with two implementations: the existing practice
  one and a new network one. Rendering, input, the view model, audio and the overlay are untouched.
- **Shot resolution.** In practice, `resolvePlayerShot` decides hits locally. In multiplayer it still
  does the local effects, sends the shot, and waits for the server for damage and markers.
- **Pause.** `pause()` becomes "open the menu" in multiplayer: the loop and the network keep running.
- **`RemotePlayer`**: position buffer, interpolation, an `AgentVisual`, positional footsteps and gunshots
  through the existing `AudioEngine` calls.
- **HUD.** Scoreboard (Tab), kill feed entries for kills between other players, match clock from the
  server, a connection indicator (ping, packet loss), team colours in Team Deathmatch.
- **Pages.** `MultiplayerPage` (cards, name, join by code), `LobbyPage`, the searching screen and the
  end-of-match scoreboard. `useAppStore` gets a `multiplayer` slice (connection, room, queue), and the
  app reads `?room=` on load to open the join flow.
- **Statistics.** A multiplayer match is saved as a session with its own mode, so it appears in history
  without being mixed into practice averages. Reaction-time and escape metrics are bot-specific and are
  left empty.

## 8. Fair play and abuse

The server is the first defence: positions, damage, ammo, fire rate and score are all computed there.
Beyond that:

- Movement: per-player time budget (6.2), so no speed-ups. Commands are simulated, so there is nothing to
  teleport with.
- Shots: the checks in 6.4, plus a cap on shots per second per weapon.
- Rooms: codes come from a 32-character alphabet (about a billion combinations). An address may send 10
  wrong codes and create 6 rooms a minute; a quick match can't be entered by code at all.
- Names: trimmed, length-limited, filtered against a word list, made unique within a room.
- Connections: 20 per address, a maximum message size, 200 messages a second per connection, and a
  socket that stops reading is dropped rather than buffered for.

What this does not stop: aim assistance and wall-hack overlays running on the player's own machine. Wall
hacks can be reduced later by not sending players the positions of enemies they have no possible line of
sight to. There is no kernel anti-cheat in a browser, and none is planned.

## 9. Bots in multiplayer

**As designed.** Filling empty slots with bots makes a 3-player room or a quiet quick match much better.
The practice bots (`Bot`, `DeathmatchBehavior`, `PracticeDirector`) assume one human target, so the plan
was to teach them to choose among several targets and to fight each other.

**As built.** A new bot, `server/MatchBot.ts`, instead of a reworked practice bot. It is a player like
any other: it has a body in the match, moves it by producing the same commands a client sends, and fires
through the same path as a client's shot. Collisions, hits, damage, scoring, snapshots and the kill feed
therefore need no special case, and clients see a bot as an ordinary player (marked "Bot" on the
scoreboard). What the file adds is the deciding:

- **Seeing.** Every 120 ms it looks for the nearest enemy inside a 130° field of view (or within 4 m)
  with a clear line of sight, using the same visibility test as the practice bots.
- **Fighting.** It turns towards the target no faster than its turn rate, waits out a reaction time,
  then fires bursts (two bullets at range, four in the middle, a spray up close) with an aim error that
  starts wide and settles. It reloads when empty and sidesteps between bursts on Normal and Hard.
- **Moving.** With nobody in view it walks a path (grid A\*) to a random place on the map, or to where
  an enemy was last seen for a few seconds after losing them. Shot from out of view, it goes to look.
- **Difficulty** sets reaction time (0.62 / 0.4 / 0.25 s), starting aim error (8° / 5° / 2.8°), turn
  rate and how often it goes for the head.

It is plainer than the practice bots: it does not hold angles, jiggle or shoulder-peek.

The room's fill number is the size the match is kept at: bots = fill number minus the people in the
room. A person joining takes the place of the lowest-scoring bot; a person leaving is replaced. Quick
match fills to 6, which is why one searching player is enough to start a match.

## 10. Build order

Each phase ends with something that can be tried.

| Phase | What                                                                                           | Done when                                                              |
| ----- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 0 ✓   | Shared-code groundwork: input interface, import test, `src/net/` message types                 | Existing tests pass; the simulation runs in a Node script              |
| 1 ✓   | Server skeleton, rooms, lobby UI                                                               | Two browsers create and join a room by code, change settings, see each other |
| 2 ✓   | Movement: prediction, correction, snapshots, remote players drawn                              | Two players run around the same map smoothly at 100 ms simulated latency |
| 3 ✓   | Combat: shots, lag compensation, damage, death, respawn, kill feed, scoreboard, match end      | A full custom Deathmatch can be played start to finish                 |
| 4 ✓   | Quick match: queue, join in progress, searching screen, idle removal                           | Players arriving at different times end up in the same match           |
| 5 ✓   | Hardening: reconnect, validation limits, rate limits, load test, deployment                    | 10 simulated clients per match, several matches, on the real host      |
| 6     | Team Deathmatch and the remaining custom settings                                              | Teams, friendly fire, weapon restrictions work                         |
| 7 ✓   | Bots in multiplayer (section 9)                                                                | A room can be filled with bots that fight everyone                     |

Testing along the way:

- Unit tests for the server's rules and matchmaker, and a prediction test that feeds the same commands to
  two `PlayerController`s and expects identical positions.
- A headless bot client (a Node script speaking the protocol) for load tests and for filling a match
  during development.
- An artificial latency and jitter setting in the client's debug helpers (`window.__TAL__.debug`),
  because netcode that is only tried on localhost has not been tried.
- A two-browser Playwright script in the style of `scripts/e2e.mjs` (not written).

## 11. Decisions

1. **Where the server runs.** Decided for now: Render's free plan, with its sleep and its small size. A
   paid instance there or elsewhere removes both.
2. **Regions.** One server location, Singapore. Players far from it will have high ping; the lobby shows
   it. More regions means a region picker and a smaller pool in each.
3. **Quick match minimum.** The design starts a match with 2 players and lets others join in progress.
   A higher minimum gives fuller matches and longer waits.
4. **Text or voice chat.** Not included. Text chat needs moderation; friends in a custom room are usually
   on a voice call already.
5. **Accounts.** Not needed for anything above. They become necessary for skill-based matching, persistent
   stats across devices, friends lists and bans.
6. **The fan-art models.** Multiplayer makes the project more public. The README already notes that some
   models carry non-commercial or Sketchfab Standard licences; check them before promoting the mode.
