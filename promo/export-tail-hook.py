#!/usr/bin/env python3
"""Render and export the added tail-hook ending.

The existing 67-second bloodtrail trailer remains untouched. This script renders
only the new 67..75 second composition frames, mixes two recorded Mandarin
voice lines over a restrained wind bed, and writes a new full trailer plus an
8-second tail clip.

Usage:
    BASE=http://127.0.0.1:53750 python3 promo/export-tail-hook.py
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROMO = ROOT / "promo"
BUILD = PROMO / "build"
FRAMES = BUILD / "frames" / "final"
TAIL_FRAMES = BUILD / "frames" / "tail_hook"
BASE_AUDIO = BUILD / "bloodtrail_audio_67.wav"
VOICE_0 = BUILD / "tts" / "tail_hook_0.wav"
VOICE_1 = BUILD / "tts" / "tail_hook_1.wav"
TAIL_AUDIO = BUILD / "tail_hook_audio_8.wav"
FULL_AUDIO = BUILD / "tail_hook_audio_75.wav"
FULL_OUTPUT = ROOT / "aotai_promo_bloodtrail_hook.mp4"
CLIP_OUTPUT = BUILD / "tail_hook_clip.mp4"
START_FRAME = 2011
TAIL_FRAMES_COUNT = 240
FULL_FRAMES_COUNT = 2250


def run(args: list[str], *, env: dict[str, str] | None = None) -> None:
    print("$", " ".join(args))
    subprocess.run(args, cwd=ROOT, env=env, check=True)


def probe(path: Path) -> dict[str, object]:
    raw = subprocess.check_output(
        [
            "ffprobe", "-v", "error", "-show_entries",
            "format=duration,size:stream=index,codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels,duration",
            "-of", "json", str(path),
        ], cwd=ROOT, text=True,
    )
    return json.loads(raw)


def render_tail(base: str) -> None:
    if not (PROMO / "compose.html").is_file() or not (PROMO / "compose.js").is_file():
        raise FileNotFoundError("compose source")
    render_text = (PROMO / "compose.js").read_text(encoding="utf-8")
    if "['sHook', 67.00, 75.00]" not in render_text or "window.DURATION = 75.0" not in render_text:
        raise RuntimeError("compose.js does not contain the final 8-second tail hook")
    if not all(p.is_file() for p in (BASE_AUDIO, VOICE_0, VOICE_1)):
        raise FileNotFoundError("base or recorded tail voice audio")
    existing = [FRAMES / f"{i:04d}.jpg" for i in range(1, START_FRAME)]
    if len(existing) != 2010 or not all(p.is_file() for p in existing):
        raise RuntimeError("the existing 67-second composition frames are incomplete")
    env = os.environ.copy()
    env["BASE"] = base
    run(["node", "promo/render.mjs", "--from", "67", "--to", "75"], env=env)
    expected = [FRAMES / f"{i:04d}.jpg" for i in range(START_FRAME, FULL_FRAMES_COUNT + 1)]
    if not all(p.is_file() for p in expected):
        raise RuntimeError(f"tail frame set is incomplete: expected {TAIL_FRAMES_COUNT} frames")
    TAIL_FRAMES.mkdir(parents=True, exist_ok=True)
    for offset, source in enumerate(expected, 1):
        target = TAIL_FRAMES / f"{offset:04d}.jpg"
        target.write_bytes(source.read_bytes())
    print(f"rendered and copied tail frames {START_FRAME}..{FULL_FRAMES_COUNT}")


def make_audio() -> None:
    # The two TTS clips start after the previous 67-second cut. The low wind bed
    # keeps the hook connected to the mountain setting without covering speech.
    common = (
        "[1:a]aresample=44100,adelay=67180|67180,volume=0.96[v0];"
        "[2:a]aresample=44100,adelay=69880|69880,volume=0.96[v1];"
        "anoisesrc=color=brown:seed=11:sample_rate=44100:duration=8:amplitude=0.008,"
        "afade=t=in:st=0:d=0.4,afade=t=out:st=7.0:d=1.0,adelay=67000|67000[wind];"
        "[0:a]aresample=44100[base];"
        "[base][v0][v1][wind]amix=inputs=4:duration=longest:dropout_transition=0,"
        "atrim=0:75,afade=t=out:st=73.7:d=1.3,alimiter=limit=0.92[out]"
    )
    run([
        "ffmpeg", "-y", "-v", "error", "-i", str(BASE_AUDIO), "-i", str(VOICE_0), "-i", str(VOICE_1),
        "-filter_complex", common, "-map", "[out]", "-ar", "44100", "-ac", "1", "-c:a", "pcm_s16le", str(FULL_AUDIO),
    ])
    run([
        "ffmpeg", "-y", "-v", "error", "-i", str(VOICE_0), "-i", str(VOICE_1),
        "-filter_complex",
        "[0:a]aresample=44100,adelay=180|180,volume=0.96[v0];"
        "[1:a]aresample=44100,adelay=2880|2880,volume=0.96[v1];"
        "anoisesrc=color=brown:seed=11:sample_rate=44100:duration=8:amplitude=0.008,"
        "afade=t=in:st=0:d=0.4,afade=t=out:st=7:d=1[wind];"
        "[v0][v1][wind]amix=inputs=3:duration=longest:dropout_transition=0,"
        "atrim=0:8,afade=t=out:st=7.2:d=0.8,alimiter=limit=0.92[out]",
        "-map", "[out]", "-ar", "44100", "-ac", "1", "-c:a", "pcm_s16le", str(TAIL_AUDIO),
    ])


def encode() -> None:
    run([
        "ffmpeg", "-y", "-v", "error", "-framerate", "30", "-start_number", "1",
        "-i", str(FRAMES / "%04d.jpg"), "-i", str(FULL_AUDIO), "-map", "0:v:0", "-map", "1:a:0",
        "-frames:v", str(FULL_FRAMES_COUNT), "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", str(FULL_OUTPUT),
    ])
    run([
        "ffmpeg", "-y", "-v", "error", "-framerate", "30", "-i", str(TAIL_FRAMES / "%04d.jpg"),
        "-i", str(TAIL_AUDIO), "-map", "0:v:0", "-map", "1:a:0", "-frames:v", str(TAIL_FRAMES_COUNT),
        "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", str(CLIP_OUTPUT),
    ])


def validate() -> None:
    for path, expected in ((FULL_OUTPUT, 75.0), (CLIP_OUTPUT, 8.0)):
        info = probe(path)
        duration = float(info["format"]["duration"])
        if abs(duration - expected) > 0.02:
            raise RuntimeError(f"{path} duration {duration} != {expected}")
        streams = info["streams"]
        if len(streams) != 2 or streams[0]["codec_type"] != "video" or streams[1]["codec_type"] != "audio":
            raise RuntimeError(f"unexpected streams in {path}: {streams}")
        if streams[0]["width"] != 1080 or streams[0]["height"] != 1920 or streams[0]["r_frame_rate"] != "30/1":
            raise RuntimeError(f"unexpected video stream in {path}: {streams[0]}")
        if streams[1].get("sample_rate") != "44100" or streams[1].get("channels") != 1:
            raise RuntimeError(f"unexpected audio stream in {path}: {streams[1]}")
        print(path.relative_to(ROOT), info["format"], streams)
        run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "null", "-"])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default=os.environ.get("BASE", "http://127.0.0.1:53750"))
    args = parser.parse_args()
    render_tail(args.base)
    make_audio()
    encode()
    validate()
    print("PASS: tail hook frames, recorded voice mix, full trailer and 8-second clip decode checks")


if __name__ == "__main__":
    main()
