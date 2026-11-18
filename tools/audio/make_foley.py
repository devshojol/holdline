#!/usr/bin/env python3
"""Cut the game's footsteps, reloads, handling, hit and kill sounds from CC0 recordings.

    python3 tools/audio/make_foley.py /path/to/folder

The folder holds these downloads from opengameart.org, the archives unpacked into folders named x_<archive>:
  Fantozzi-footsteps.7z            /content/fantozzis-footsteps-grasssand-stone      a step on stone (the landing)
  RPGsounds_Kenney.zip             /content/50-rpg-sound-effects                     footsteps, cloth, leather, metal
  reload.wav                       /content/handgun-reload-sound-effect              handgun: magazine out, in, slide
  assaultriflereload1_0.wav        /content/gun-reload-sounds                        rifle magazine change
  equipmentclicks.wav              /content/equipment-clicks-ii                      bolt-action rifle being cocked
  independent_nu_ljudbank-hits_and_punches.7z  /content/37-hitspunches               body hits
  slightscreams.7z                 /content/15-vocal-male-strainhurtpainjump-sounds  short pain and effort voices
All are CC0. Every clip is written mono, 44.1 kHz, peak-normalised, and listed in public/sounds/manifest.json.
Needs ffmpeg.
"""
import json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "public", "sounds")
LIB = sys.argv[1]
STONE = "x_Fantozzi-footsteps/Fantozzi-footsteps/flac/Fantozzi-Stone{}.flac"
K = "x_RPGsounds_Kenney/OGG/{}.ogg"
HIT = "x_independent_nu_ljudbank-hits_and_punches/hits/hit{}.mp3.flac"
VOICE = "x_slightscreams/slightscream-{}.flac"


def ffmpeg(args):
    return subprocess.run(["ffmpeg", "-hide_banner", "-nostdin", "-y", *args], capture_output=True, text=True).stderr


def make(name, layers, peak=-3.0, fade=0.06):
    """One clip from one or more layers: (file, start s, length s, filters or None, delay s, gain dB)."""
    args, graph, labels = [], [], []
    total = 0.0
    for i, (src, start, length, extra, delay, gain) in enumerate(layers):
        args += ["-i", os.path.join(LIB, src)]
        chain = [f"atrim=start={start}:duration={length}", "asetpts=PTS-STARTPTS", "aformat=channel_layouts=mono", "aresample=44100"]
        if extra:
            chain.append(extra)
        chain += [f"volume={gain}dB", f"adelay={int(delay * 1000)}"]
        graph.append(f"[{i}:a]{','.join(chain)}[l{i}]")
        labels.append(f"[l{i}]")
        total = max(total, delay + length)
    graph.append(f"{''.join(labels)}amix=inputs={len(layers)}:normalize=0:duration=longest,afade=t=out:st={max(0, total - fade):.3f}:d={fade}[m]")
    tmp = os.path.join(OUT, f".{name}.wav")
    ffmpeg([*args, "-filter_complex", ";".join(graph), "-map", "[m]", "-c:a", "pcm_s16le", tmp])
    level = float(re.search(r"max_volume: ([-\d.]+) dB", ffmpeg(["-i", tmp, "-af", "volumedetect", "-f", "null", "-"])).group(1))
    ffmpeg(["-i", tmp, "-af", f"volume={peak - level:.2f}dB", "-c:a", "pcm_s16le", os.path.join(OUT, name + ".wav")])
    os.remove(tmp)
    return name + ".wav"


LOW = "lowpass=f=1800"                 # keeps the weight of a hit, drops the slap
RING = "highpass=f=900"                # keeps a metal ring, drops its thump
manifest_path = os.path.join(OUT, "manifest.json")
manifest = json.load(open(manifest_path))

# footsteps: six soft boot steps, dull and low (the game makes the wood and metal versions from them).
# The brighter steps on stone from the Fantozzi set were tried first and sounded too clicky.
manifest["footstep"] = [make(f"step-{i + 1}", [(K.format(f"footstep0{n}"), 0, 0.24, "lowpass=f=3200", 0, 0)], peak=-6, fade=0.05) for i, n in enumerate((0, 1, 2, 3, 7, 8))]
# jump: cloth and a push off the ground. landing: a heavier, lower step with gear settling
manifest["jump"] = [make("jump-1", [(K.format("cloth2"), 0.05, 0.3, None, 0, 0), (K.format("footstep05"), 0, 0.2, None, 0.02, -6)], peak=-9)]
manifest["land"] = [make("land-1", [(STONE.format("L2"), 0, 0.33, "asetrate=44100*0.78,aresample=44100", 0, 0), (K.format("dropLeather"), 0.02, 0.3, None, 0.03, -5)], peak=-4)]

# reloads: the rifle magazine change for long guns, the handgun's for the sidearms
manifest["reload"] = [make("reload-rifle", [("assaultriflereload1_0.wav", 0.2, 1.3, None, 0, 0)], peak=-4)]
pistol = make("reload-pistol", [("reload.wav", 0.05, 1.4, None, 0, 0)], peak=-4)
for gun in ("pilot", "whisper", "magnate"):
    manifest[f"reload-{gun}"] = [pistol]
# the bolt of the sniper rifle. The game plays this once to open it and once to close it, so each take is one movement
manifest["bolt"] = [make("bolt-1", [("equipmentclicks.wav", 1.9, 0.24, None, 0, 0)], peak=-4),
                    make("bolt-2", [("equipmentclicks.wav", 2.24, 0.26, None, 0, 0)], peak=-4)]
# drawing a gun: webbing and cloth, then the gun seating in the hands. an empty chamber: one small click
manifest["equip"] = [make("equip-1", [(K.format("clothBelt"), 0.04, 0.5, None, 0, -4), (K.format("metalLatch"), 0.02, 0.2, None, 0.3, -8)], peak=-8)]
manifest["dry"] = [make("dry-1", [(K.format("metalClick"), 0.06, 0.1, None, 0, 0)], peak=-10, fade=0.02)]

# a bullet hitting a body: a short dull impact
manifest["hit"] = [make(f"hit-{i + 1}", [(HIT.format(n), start, 0.26, LOW, 0, 0)], peak=-5) for i, (n, start) in enumerate((("34", 0.04), ("20", 0.16), ("26", 0.15)))]
# a headshot: the crack of the impact with the ring of a helmet
manifest["headshot"] = [make("headshot-1", [(HIT.format("10"), 0.04, 0.22, None, 0, 0), (K.format("metalPot3"), 0.05, 0.4, RING + ",asetrate=44100*1.5,aresample=44100", 0, -3)], peak=-3, fade=0.2)]
# a kill: a heavy body impact with a low metal knock that climbs one step with every kill in a streak
for n, rate in enumerate((1.0, 1.122, 1.26, 1.335, 1.498), 1):
    manifest[f"kill{n}"] = [make(f"kill-{n}", [(HIT.format("19"), 0.05, 0.45, LOW, 0, 0),
                                              (K.format("metalPot1"), 0.08, 0.6, f"{RING},asetrate=44100*{rate},aresample=44100", 0.01, -7)], peak=-3, fade=0.3)]
# being hit: an impact and a short grunt
manifest["hurt"] = [make(f"hurt-{i + 1}", [(HIT.format(h), hs, 0.3, LOW, 0, 0), (VOICE.format(v), vs, vl, None, 0.05, -5)], peak=-4)
                    for i, (h, hs, v, vs, vl) in enumerate((("33", 0.11, "11", 0.06, 0.27), ("37", 0.11, "08", 0.04, 0.36), ("30", 0.12, "12", 0.11, 0.26)))]
json.dump(manifest, open(manifest_path, "w"), indent=2)
print("written:", ", ".join(k for k in ("footstep", "jump", "land", "reload", "reload-classic", "bolt", "equip", "dry", "hit", "headshot", "kill1", "hurt")))
