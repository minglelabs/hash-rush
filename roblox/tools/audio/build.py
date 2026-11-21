#!/usr/bin/env python3
"""Turns what render.html rendered (out/*.wav) into the files to upload to Roblox,
and writes src/client/Sounds.luau, which says where each effect sits in its file.

  python3 roblox/tools/audio/build.py
  python3 roblox/tools/audio/build.py --effects ID --game ID --lobby ID

The ids are the ones Roblox gives the uploads (--game takes one per round file);
they are kept in ids.json, so a later run without them keeps them. The uploads:
out/effects.ogg, out/music-round-1.ogg, -2.ogg ... (the round tunes back to back in
the web game's playlist order, cut where a file would pass Roblox's limit on
audio length) and out/music-lobby.ogg. The levels are the web game's own,
untouched. Needs ffmpeg."""
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
parser.add_argument("--effects", type=int)
parser.add_argument("--game", type=int, nargs="+")
parser.add_argument("--lobby", type=int)
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
ffmpeg("-i", str(OUT / "music-lobby.wav"), "-c:a", "libvorbis", "-q:a", "5", str(OUT / "music-lobby.ogg"))

# Roblox turned the twelve minutes of round tunes down as one file ("Audio duration
# too long"), so they go in files of whole tunes, each kept under this.
LONGEST = 6.5 * 60
parts = [[]]
for n in order:
    length = seconds(OUT / f"music-{n}.wav")
    if parts[-1] and sum(l for _, l in parts[-1]) + length > LONGEST:
        parts.append([])
    parts[-1].append((n, length))
for old in OUT.glob("music-round*.ogg"):
    old.unlink()
files = []
for k, part in enumerate(parts, 1):
    listing = OUT / f"round-{k}.txt"
    listing.write_text("".join(f"file 'music-{n}.wav'\n" for n, _ in part), encoding="utf-8")
    files.append(f"music-round-{k}.ogg")
    ffmpeg("-f", "concat", "-safe", "0", "-i", str(listing), "-c:a", "libvorbis", "-q:a", "5", str(OUT / files[-1]))

sprite = json.loads((OUT / "effects.json").read_text(encoding="utf-8"))
game_ids = ids.get("game") or []
if isinstance(game_ids, int) or len(game_ids) != len(parts):
    game_ids = [None] * len(parts)


def starts_of(part):
    out, at = [], 0.0
    for _, length in part:
        out.append(round(at, 3))
        at += length
    return out


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
    "\t\t-- The round tunes back to back, in files short enough for Roblox, played",
    "\t\t-- one after the other; each tune starts where it says in its file.",
    "\t\tgame = {",
    *(f"\t\t\t{{ id = {luau(i)}, starts = {{ {', '.join(str(s) for s in starts_of(part))} }} }}, -- {', '.join(n for n, _ in part)}"
      for i, part in zip(game_ids, parts)),
    "\t\t},",
    f"\t\tlobby = {{ id = {luau(ids.get('lobby'))} }},",
    "\t},",
    "}",
    "",
]
SOUNDS.write_text("\n".join(lines), encoding="utf-8")
for f in ("effects.ogg", *files, "music-lobby.ogg"):
    print(f, f"{(OUT / f).stat().st_size / 1e6:.1f} MB")
print("wrote", SOUNDS.relative_to(ROOT.parent))
