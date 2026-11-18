#!/usr/bin/env python3
"""Cut the game's gunshots from the Freesound pack "Real Gun Sounds" by areniporgen (CC0).

    python3 tools/audio/make_gun_sounds.py /path/to/folder

The pack (https://freesound.org/people/areniporgen/packs/38798/) is recordings of real weapons made for film,
each sound CC0. The folder holds these, named as below (the site's preview files or the original WAVs):
  m4a1              Colt M4A1 SOCOM                    /sounds/737569/
  p90               FN P90 (Full Auto)                 /sounds/740896/
  tac50-suppressed  MacMillan Tac-50A1-R2 Suppressed   /sounds/737570/
  asp-9mm           ASP Pistol                         /sounds/734061/
  colt-1911         Colt 1911                          /sounds/740897/
  usp45             Heckler & Koch USP45               /sounds/734062/
  p226-suppressed   SIG Sauer P226 (Suppressed)        /sounds/828790/

The shots are used as recorded: cut at the shot, mono, 44.1 kHz, faded out at the end and peak-normalised.
No pitch change, no added bass, no artificial reverb: an earlier version built the shots up that way from
thinner recordings and they came out sounding like drums.
Writes public/sounds/<gun>-1.wav and lists them in public/sounds/manifest.json. Needs ffmpeg.
"""
import glob, json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "public", "sounds")
# game weapon id: (recording, start s, length s, peak dB, extra filter or None, fade in dB per second after the shot)
# The fade is for the film-style recordings that hold almost full level for a second or more: left alone they
# would pile up in automatic fire. It only turns the ring down over time; the sound itself is untouched.
GUNS = {
    "vandal": ("m4a1", 0.04, 0.9, -1.0, None, 26),                     # Kestrel: 5.56 carbine, long open-air ring
    "phantom": ("p226-suppressed", 0.765, 0.6, -5.0, "lowpass=f=3600", 0),  # Halcyon: suppressed, the duller of the two
    "spectre": ("p90", 2.972, 0.42, -2.5, None, 0),                      # Hornet: the last round of a burst, so it ends naturally
    "guardian": ("usp45", 0.04, 1.1, -1.0, None, 0),                     # Arbiter: a hard .45 bang with a medium ring
    "operator": ("tac50-suppressed", 0.015, 2.2, -0.3, None, 10),         # Monarch: a .50 rifle, the longest and heaviest
    "classic": ("asp-9mm", 0.04, 0.9, -2.5, None, 0),                    # Pilot: 9 mm pistol
    "ghost": ("p226-suppressed", 1.47, 0.6, -6.0, "highpass=f=180", 0),  # Whisper: suppressed 9 mm pistol
    "sheriff": ("colt-1911", 0.02, 1.0, -1.0, None, 20),                  # Magnate: .45, a big boom
}


def run(args):
    return subprocess.run(["ffmpeg", "-hide_banner", "-nostdin", *args], capture_output=True, text=True).stderr


def main(lib):
    manifest_path = os.path.join(OUT, "manifest.json")
    manifest = json.load(open(manifest_path))
    for old in glob.glob(os.path.join(OUT, "*-2.wav")):  # second takes from the previous library
        if os.path.basename(old).split("-")[0] in GUNS:
            os.remove(old)
    for gun, (name, start, keep, peak, extra, fade) in GUNS.items():
        found = glob.glob(os.path.join(lib, name + ".*"))
        if not found:
            raise SystemExit(f"{gun}: no file named {name}.* in {lib}")
        chain = [f"atrim=start={start}:duration={keep}", "asetpts=PTS-STARTPTS", "aformat=channel_layouts=mono", "aresample=44100"]
        if extra:
            chain.append(extra)
        if fade:
            chain.append(f"volume=eval=frame:volume='if(lt(t,0.07),1,pow(10,-{fade}*(t-0.07)/20))'")
        chain.append(f"afade=t=out:st={keep * 0.7:.3f}:d={keep * 0.3:.3f}")
        tmp = os.path.join(OUT, f".{gun}.wav")
        run(["-y", "-i", found[0], "-af", ",".join(chain), "-c:a", "pcm_s16le", tmp])
        level = float(re.search(r"max_volume: ([-\d.]+) dB", run(["-i", tmp, "-af", "volumedetect", "-f", "null", "-"])).group(1))
        out = f"{gun}-1.wav"
        run(["-y", "-i", tmp, "-af", f"volume={peak - level:.2f}dB", "-c:a", "pcm_s16le", os.path.join(OUT, out)])
        os.remove(tmp)
        manifest[gun] = [out]
        print(f"{gun:9s} from {os.path.basename(found[0])}")
    json.dump(manifest, open(manifest_path, "w"), indent=2)


if __name__ == "__main__":
    main(sys.argv[1])
