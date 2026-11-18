# Recorded sounds

Every sound is synthesised in the browser by default (gunshots in `src/game/audio/gunSynth.ts`, everything else in
`src/game/audio/AudioEngine.ts`). A key in `manifest.json` with one or more files replaces the synthesised sound for
that slot. An empty list keeps the synthesised one.

## Slots

| Key | Plays when | Synthesised fallback |
| --- | --- | --- |
| `vandal`, `phantom`, `spectre`, `guardian`, `operator`, `classic`, `ghost`, `sheriff` | that gun fires | layered shot per weapon |
| `footstep` | the player or a bot takes a step. Every take has its background stripped, its low end boosted and its level brought up, and a wooden and a metal version are made from it for steps on crates and containers | six scuffs per surface |
| `jump` | you jump | shoe push-off with a clothes-and-gear rustle |
| `land` | you land (louder after a bigger drop), together with a step for the surface | deep double thud with a scuff |
| `reload` | any gun reloads (replaces the three mag-out / mag-in / bolt cues) | three mechanical clicks |
| `reload-vandal`, `reload-phantom`, `reload-spectre`, `reload-guardian`, `reload-operator`, `reload-classic`, `reload-ghost`, `reload-sheriff` | that gun reloads (wins over `reload`) | as above |
| `headshot` | your shot hits a head | bright ringing ping |
| `hit` | your shot hits a body | short tick |
| `hurt` | you are hit | low thud |
| `bolt` | the sniper's bolt opens, and closes | click |
| `equip` | a gun is drawn | rustle and click |
| `dry` | the trigger is pulled on an empty gun | click |
| `kill1` … `kill5` | your 1st … 5th kill in a row (the 5th repeats after that; dying resets the streak) | rising chime, one note per kill |
| `vandal-kill1` … `sheriff-kill5` | the same, but only for kills with that gun (wins over `kill1` … `kill5`) | as above |

Example:

```json
{
  "vandal": ["vandal-1.wav", "vandal-2.wav"],
  "footstep": ["step-1.wav", "step-2.wav", "step-3.wav"],
  "reload-vandal": ["vandal-reload.wav"],
  "kill1": ["kill-1.wav"],
  "kill2": ["kill-2.wav"]
}
```

## Gunshots (CC0)

All eight guns fire recordings of real weapons from the Freesound pack **"Real Gun Sounds" by areniporgen**
(<https://freesound.org/people/areniporgen/packs/38798/>), made for film; every sound in it is CC0 (no rights
reserved, any use, no credit needed). `tools/audio/make_gun_sounds.py` cuts one shot per gun and uses it as
recorded: no pitch change, no added bass, no artificial reverb. The three recordings that hold their level for
over a second are faded so they don't pile up in automatic fire. The files here were cut from the site's preview
files (compressed); the original WAVs need a Freesound login.

| Gun | Recording |
| --- | --- |
| Kestrel (`vandal`) | Colt M4A1 SOCOM, 5.56 |
| Halcyon (`phantom`) | SIG Sauer P226, suppressed (second shot, low-passed) |
| Hornet (`spectre`) | FN P90, the last round of a burst |
| Arbiter (`guardian`) | Heckler & Koch USP45, .45 |
| Monarch (`operator`) | MacMillan Tac-50, .50 BMG, suppressed |
| Pilot (`classic`) | ASP pistol, 9 mm |
| Whisper (`ghost`) | SIG Sauer P226, suppressed (third shot) |
| Magnate (`sheriff`) | Colt 1911, .45 |

## Footsteps, reloads, handling, hits and kills (CC0)

Cut by `tools/audio/make_foley.py` from these CC0 uploads on opengameart.org (no credit required):

| Sound | Recording | Page |
| --- | --- | --- |
| Landing | "Fantozzi's Footsteps (Grass/Sand & Stone)", a stone step dropped in pitch | `/content/fantozzis-footsteps-grasssand-stone` |
| Footsteps, jump, drawing a gun, empty-chamber click, the metal ring in headshots and kills | "50 RPG sound effects" (Kenney) | `/content/50-rpg-sound-effects` |
| Reload, long guns | "Gun reload sounds", the rifle magazine change | `/content/gun-reload-sounds` |
| Reload, sidearms | "Handgun reload sound effect" | `/content/handgun-reload-sound-effect` |
| Sniper bolt | "Equipment clicks II", a bolt-action rifle being cocked | `/content/equipment-clicks-ii` |
| Bullet hitting a body, headshot, kill, being hit | "37 hits/punches" | `/content/37-hitspunches` |
| The grunt when you are hit | "15 vocal male strain/hurt/pain/jump sounds" | `/content/15-vocal-male-strainhurtpainjump-sounds` |

A kill is a heavy body impact with a low metal knock that climbs one step with each kill in a streak (`kill1` … `kill5`).
Bullets hitting walls and passing close by have no recording and stay synthesised.

## Notes

- WAV, MP3 or OGG all work. When a slot lists several files, one is picked at random each time (footsteps and shots
  also get a small pitch variation), so repeats don't sound looped.
- Silence at the start and end of every file is trimmed when it loads, so sounds play on time. The engine adds
  distance filtering, HRTF panning and reverb for sounds made by enemies.
- A `footstep` file longer than 0.8 s is treated as a walking recording and cut into single steps when it loads
  (one is picked at random per step). Each walker only ever plays one step at a time.
- A reload file is cut in two at the pause between its two loudest sounds (magazine out, magazine in) and each half
  is played when the reload animation reaches that moment, whatever the gun's reload time. A file with no such pause
  is played whole when the reload starts. Either way it stops if the reload is cut short (weapon switch).
- Only one kill sound plays at a time: a quick second kill cuts the first. When the kill sound is a recording, the
  synthesised headshot ping is skipped on that kill so the two don't clash (record a `headshot` file to keep one).
- Only ship recordings you have the rights to. The single-file build (`npm run build:single`) never includes these files.
