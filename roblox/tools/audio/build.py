#!/usr/bin/env python3
"""Turns what render.html rendered (out/*.wav) into the files to upload to Roblox,
and writes src/client/Sounds.luau, which says where each effect sits in its file.

  python3 roblox/tools/audio/build.py
  python3 roblox/tools/audio/build.py --effects ID --game ID --lobby ID

The ids are the ones Roblox gives the uploads; they are kept in ids.json, so a
later run without them keeps them. The uploads: out/effects.ogg, out/music-round.ogg
(every round tune back to back, in the web game's playlist order) and
out/music-lobby.ogg. The levels are the web game's own, untouched. Needs ffmpeg."""
import argparse
import json
import re
import subprocess
import wave
from pathlib import Path

HERE = Path(__file__).parent
OUT = HERE / "out"
ROOT = HERE.parent.parent
SOUNDS = ROOT / "src" / "client" / "Sounds.luau"
IDS = HERE / "ids.json"
MUSIC_JS = ROOT.parent / "src" / "client" / "music.js"

parser = argparse.ArgumentParser()
for name in ("effects", "game", "lobby"):
    parser.add_argument("--" + name, type=int)
args = parser.parse_args()
ids = json.loads(IDS.read_text()) if IDS.exists() else {}
for name in ("effects", "game", "lobby"):
    if getattr(args, name):
        ids[name] = getattr(args, name)
IDS.write_text(json.dumps(ids, indent=2) + "\n")

playlist = re.search(r"game: \[([^\]]*)\]", MUSIC_JS.read_text(encoding="utf-8")).group(1)
order = re.findall(r"'([a-z]+)'", playlist)


def seconds(path):
    with wave.open(str(path)) as w:
        return w.getnframes() / w.getframerate()


def ffmpeg(*a):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *a], check=True)


ffmpeg("-i", str(OUT / "effects.wav"), "-c:a", "libvorbis", "-q:a", "6", str(OUT / "effects.ogg"))
listing = OUT / "game.txt"
listing.write_text("".join(f"file 'music-{n}.wav'\n" for n in order), encoding="utf-8")
ffmpeg("-f", "concat", "-safe", "0", "-i", str(listing), "-c:a", "libvorbis", "-q:a", "5", str(OUT / "music-round.ogg"))
ffmpeg("-i", str(OUT / "music-lobby.wav"), "-c:a", "libvorbis", "-q:a", "5", str(OUT / "music-lobby.ogg"))

sprite = json.loads((OUT / "effects.json").read_text(encoding="utf-8"))
starts, at = [], 0.0
for n in order:
    starts.append(round(at, 3))
    at += seconds(OUT / f"music-{n}.wav")


def luau(v):
    return "nil" if v is None else str(v)


lines = [
    "-- Where the web game's own sounds are (src/client/audio.js, music.js), as",
    "-- tools/audio renders them and Roblox holds them once uploaded. Written by",
    "-- tools/audio/build.py: run it again rather than editing this. Without ids",
    "-- Fx plays Roblox's own sounds in their place.",
    "return {",
    f"\teffects = {luau(ids.get('effects'))},",
    "\t-- One loudness for effects and music: the balance the web game has.",
    "\tvolume = 1,",
    "\t-- Each effect: where it starts in the effects file and how long it is, in seconds.",
    "\tsprite = {",
    *(f"\t\t{name} = {{ {start}, {length} }}," for name, (start, length) in sprite.items()),
    "\t},",
    "\tmusic = {",
    f"\t\t-- Every round tune back to back: {', '.join(order)}.",
    f"\t\tgame = {{ id = {luau(ids.get('game'))}, starts = {{ {', '.join(str(s) for s in starts)} }} }},",
    f"\t\tlobby = {{ id = {luau(ids.get('lobby'))} }},",
    "\t},",
    "}",
    "",
]
SOUNDS.write_text("\n".join(lines), encoding="utf-8")
for f in ("effects.ogg", "music-round.ogg", "music-lobby.ogg"):
    print(f, f"{(OUT / f).stat().st_size / 1e6:.1f} MB")
print("wrote", SOUNDS.relative_to(ROOT.parent))
