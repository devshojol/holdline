# Multiplayer: how it works

A design for playing against other people, in two ways:

- **Custom**: create a room, invite up to 9 friends (10 players in all), pick the map, the time and the
  rules, and start when you like.
- **Quick match**: pick a map, wait for other players, and the match starts by itself.

This document describes the player's experience, the rules, the architecture and the order to build it
in. Decisions that are still open are collected in [section 11](#11-open-decisions).

**Status.** Phases 0 to 5 of the [build order](#10-build-order) are done. The game server is deployed on
Fly.io ([Deploying](#deploying)); the live website is not yet built with the multiplayer code and the
server's address, so players can't reach it from there yet. Both modes can be played from start to finish. Custom: create a room, invite by code or link,
set it up, start, fight, and return to the room with the final score. Quick match: pick maps, wait, and a
match forms by itself or you join one already under way; when it ends its room closes and Play again
searches anew. Combat is decided by the server with lag compensation. Still to come: the client side of
Team Deathmatch and weapon restrictions (6), and bots that fill a room (7).

Where the build differs from the design below, for now:

- A weapon picked in the B menu is in your hands at once, not at the next respawn.
- The server checks a shot's gun, fire rate, origin and direction, but does not count the magazine.
- The run-speed multiplier (weapon in hand, aiming) is sent by the client and clamped by the server.
- Team Deathmatch and the weapon rule are enforced by the server (teammates aren't hurt, a banned gun's
  shots do nothing), but the client doesn't yet show team colours or lock the banned guns.
- Other players always appear holding the Vandal, and don't show on the minimap.
- Quick match picks a random map among equals; it doesn't yet avoid the map the players last played.
- Names are trimmed and made unique in a room, but there is no word filter.
- Enemies' positions are sent to every player whether or not they could be seen (no wall-hack reduction).
- A player whose connection drops mid-match comes back at a fresh spawn, with their score.

### Trying it

```bash
npm run server       # the game server, on port 8787 (PORT=… to change)
npm run dev          # the app; in development it connects to port 8787 on the same machine
```

Open the app in two tabs (each tab is its own player), go to Multiplayer, create a room in one and open
its invite link in the other. A browser only runs the game in the tab you are looking at, so to see
other players move without a second person, add headless bot players to the room:

```bash
npm run mp:bot -- K7M2QX 3         # three bots join room K7M2QX and run around once the match starts
npm run mp:bot -- K7M2QX 6 shoot   # six that also stop and shoot at anyone they see (poor shots, on purpose)
npm run mp:bot -- quick 3 shoot    # three that search for a quick match instead, and again after each one
```

In a match, `window.__TAL__.debug` has `net()` (snapshot count, commands in flight, prediction
corrections, where the other players are drawn), `netLag(ms, jitter)` to add delay to the connection,
`spectateRemote(index)` to watch another player from outside and `aimAtRemote(index)` to point at one. A production build talks to the server named in `VITE_MP_SERVER`
(for example `wss://play.example.com`); without it the Multiplayer page says the mode is unavailable.
The server accepts browsers from any site unless `ALLOWED_ORIGINS` lists the allowed ones.

### Deploying

The website and the game server are deployed separately.

**The game server** is one Node process. `npm run server:build` bundles it and everything it shares with
the client into a single file, `dist-server/index.cjs`, which runs with nothing else installed
(`npm run server:start`, Node 20 or newer). The `Dockerfile` in the repository root builds an image that
does the same: bun installs the dependencies from `bun.lock`, and the 67 MB result runs on Node.

| Setting           | Meaning                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------- |
| `PORT`            | Port to listen on (default 8787). Most hosts set this for you.                           |
| `ALLOWED_ORIGINS` | Comma-separated sites whose pages may connect, e.g. `https://your-site.example`. Unset = any site. Set it in production. |
| `MAX_PER_ADDRESS` | Connections allowed from one address (default 20).                                      |
| `CLIENT_IP_HEADER` | Behind a host's proxy: the request header carrying the visitor's address (Fly.io: `fly-client-ip`). Without it every player counts as the proxy's one address. Only set it when a trusted proxy fills the header. |

What the host must provide:

- **A long-lived process with WebSockets.** Not a serverless function.
- **Exactly one instance.** Rooms live in the process's memory, so two instances would be two separate
  worlds with players unable to find each other's rooms. Turn off autoscaling and scale-to-zero.
- **TLS.** A page served over `https` may only open `wss://` connections, so the server needs a
  certificate; hosts that give the app an `https` address provide this.
- **A health check.** Any plain HTTP request to the server answers with JSON: rooms, players, players
  searching, memory, and the last five seconds' tick time, traffic and message rate.

A restart or a deploy ends every match in progress (clients are told at once and return to the
Multiplayer page), so deploy when it is quiet.

**On Fly.io.** The server is deployed as the app `tactical-aim-lab-server` in Singapore (`sin`), at
`wss://tactical-aim-lab-server.fly.dev`. `fly.toml` in the repository root holds its settings: one
always-on machine that is never stopped or doubled, HTTPS, the health check, and `CLIENT_IP_HEADER`.
Only pages on the live site's three Vercel addresses may connect (the `ALLOWED_ORIGINS` secret); a page
on `localhost` is refused, so local development uses a local server.

```bash
fly deploy --ha=false                                  # deploy a new version (ends matches in progress)
fly status                                             # one machine, "1 total, 1 passing"
curl https://tactical-aim-lab-server.fly.dev/          # the health check: {"ok":true,...}
fly logs                                               # the server's output
fly secrets set ALLOWED_ORIGINS=https://a.example,https://b.example   # change which sites may connect
```

Setting it up from nothing, on another account or under another name:

```bash
fly auth login
fly launch --copy-config --no-deploy --ha=false --name YOUR-APP --region sin
fly secrets set --stage ALLOWED_ORIGINS=https://your-site.example
fly deploy --ha=false
fly ips allocate-v4 --shared && fly ips allocate-v6    # if the first deploy reports it could not provision addresses
fly scale count 1                                      # make sure there is exactly one machine
```

Checked on the deployed server: the health check answers, a connection from the live site's address is
accepted and one from any other site (or none) is refused, the round trip from the development machine
is about 83 ms, and a full ten-bot match ran at under 0.5 ms a tick in 69 MB. To send test bots at it:

```bash
MP_SERVER=wss://tactical-aim-lab-server.fly.dev MP_ORIGIN=https://valorantaimlab.vercel.app npm run mp:bot -- quick 10 shoot
```

**The website**: set `VITE_MP_SERVER` to the server's address (for example `wss://play.your-site.example`)
(`wss://tactical-aim-lab-server.fly.dev`) in the site's build environment and rebuild. This has not been
done yet, and the live site does not have the multiplayer code yet either. Without it the Multiplayer page says the mode is
unavailable.

### Load

Measured on a development laptop with `npm run mp:bot -- quick N shoot`, the bots in a second process on
the same machine:

| Matches × players | Tick time (average / worst) | Server CPU      | Memory | Sent per player |
| ----------------- | --------------------------- | --------------- | ------ | --------------- |
| 5 × 10            | 2.0 ms / 6 ms               | 14% of one core | 135 MB | 22 KB/s         |
| 10 × 10           | 3.6 ms / 12 ms              | 37% of one core | 150 MB | 22 KB/s         |

A tick has 33 ms to finish, so one small instance has room for well over ten full matches. Bandwidth is
the cost to watch: 100 players is about 2.2 MB/s out. These are bots on one machine with no real network
between them; the same test should be repeated against the real host once there is one.

## 1. Where we are

The game today is a static site with no server (it deploys to Vercel, and can even be one HTML file).
Everything is single-player:

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

A new **Multiplayer** item in the navigation, next to Practice. The page has two cards, Quick match and
Custom, plus a display-name field. The name is the only identity: it is stored in localStorage with a
random player id. No account, no password.

Crosshair, sensitivity, graphics, audio and loadout come from the existing settings, unchanged.

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

Bots that fill empty slots are a wanted setting but are not in the first version: see
[section 9](#9-bots-in-multiplayer).

## 4. Quick match matchmaking

One queue, with each waiting player carrying the set of maps they accept. A match is a room like any
other, created by the server instead of by a host.

The server looks at the queue once a second and, for each waiting player in order of arrival:

1. **Join a running match.** If a quick match on an accepted map has a free slot and more than 3 minutes
   or 10 kills left, the player joins it. This is what keeps waits short when few people are online.
2. **Start a new match.** Otherwise the player waits. When 10 players accept a common map, the match
   starts immediately. When at least **2** do, a 15-second timer starts for that group; anyone who arrives
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
| C → S     | `hello`          | protocol version, player id, name, resume token if reconnecting         |
| C → S     | `room.create` / `room.join` / `room.leave` | room code where needed                        |
| C → S     | `room.settings` / `room.kick` / `room.host` / `room.start` / `room.end` | host only        |
| C → S     | `room.ready` / `room.team` / `loadout` | the player's own state                            |
| C → S     | `queue.join` / `queue.leave` | accepted maps                                               |
| S → C     | `room.state`     | code, settings, players (name, ready, team, host, ping), phase          |
| S → C     | `queue.state`    | waiting count, timer                                                    |
| S → C     | `match.start`    | map, settings, your spawn, server clock, end time                       |
| C → S     | `input`          | the last few commands                                                   |
| C → S     | `shot`           | as in 6.4                                                               |
| S → C     | `snapshot`       | server time, last applied command, your state, every other player's state |
| S → C     | `event`          | shot, hit, kill, respawn, join, leave                                   |
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

Filling empty slots with bots would make a 3-player room or a quiet quick match much better, and the
bots are the best part of this project. It is left out of the first version for a concrete reason: `Bot`,
`DeathmatchBehavior` and `PracticeDirector` assume one human target (`BotContext.player`,
`visibleToPlayer`, a single grace timer, `maxAttackers` slots per player). Running them on the server
means teaching them to choose among several targets and to fight each other, which is its own piece of
work (and is already on the README's list as "bots that fight each other in Deathmatch").

Once that is done, bots run only on the server and reach clients as ordinary players in the snapshot, so
no client work is needed. Custom rooms then gain "Fill with bots" and a difficulty; quick match fills to
a minimum of 6.

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
| 7     | Bots in multiplayer (section 9)                                                                | A room can be filled with bots that fight everyone                     |

Testing along the way:

- Unit tests for the server's rules and matchmaker, and a prediction test that feeds the same commands to
  two `PlayerController`s and expects identical positions.
- A headless bot client (a Node script speaking the protocol) for load tests and for filling a match
  during development.
- An artificial latency, jitter and loss setting in the client's debug helpers (`window.__TAL__.debug`),
  because netcode that is only tried on localhost has not been tried.
- A two-browser Playwright script in the style of `scripts/e2e.mjs`.

## 11. Open decisions

1. **Where the server runs.** Any host with long-lived processes works. This is the only part of the
   feature with a running cost and an account to set up, so it is the owner's call.
2. **Regions.** One server location to start. Players far from it will have high ping; the lobby shows
   it. More regions means a region picker and a smaller pool in each.
3. **Quick match minimum.** The design starts a match with 2 players and lets others join in progress.
   A higher minimum gives fuller matches and longer waits.
4. **Text or voice chat.** Not included. Text chat needs moderation; friends in a custom room are usually
   on a voice call already.
5. **Accounts.** Not needed for anything above. They become necessary for skill-based matching, persistent
   stats across devices, friends lists and bans.
6. **The fan-art models.** Multiplayer makes the project more public. The README already notes that some
   models carry non-commercial or Sketchfab Standard licences; check them before promoting the mode.
