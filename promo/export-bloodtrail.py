#!/usr/bin/env python3
"""Re-render and export the bloodtrail insert without rebuilding the full film.

Usage:
    BASE=http://127.0.0.1:53750 python3 promo/export-bloodtrail.py

The source 60-second trailer is never overwritten. This script renders the
7-second shot, replaces frames 1270..1479 in the already rendered 67-second
composition, inserts a deterministic seven-second wind bed between the two
original audio ranges, then encodes both deliverables and validates them.
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROMO = ROOT / "promo"
BUILD = PROMO / "build"
SHOT_FRAMES = BUILD / "frames" / "bloodtrail"
FULL_FRAMES = BUILD / "frames" / "final"
ORIGINAL = ROOT / "aotai_promo_9x16_updated.mp4"
FULL_AUDIO = BUILD / "bloodtrail_audio_67.wav"
WIND_AUDIO = BUILD / "bloodtrail_wind_7.wav"
FULL_OUTPUT = ROOT / "aotai_promo_bloodtrail.mp4"
CLIP_OUTPUT = BUILD / "bloodtrail_clip.mp4"
INSERT_START = 1270
SHOT_FRAMES_COUNT = 210


def run(args: list[str], *, env: dict[str, str] | None = None) -> None:
    print("$", " ".join(args))
    subprocess.run(args, cwd=ROOT, env=env, check=True)


def ffprobe(path: Path) -> dict[str, object]:
    import json

    raw = subprocess.check_output(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration,size:stream=index,codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels,duration",
            "-of",
            "json",
            str(path),
        ],
        cwd=ROOT,
        text=True,
    )
    return json.loads(raw)


def render_shot(base: str) -> None:
    SHOT_FRAMES.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env["BASE"] = base
    run(
        [
            "node",
            "promo/shoot.mjs",
            "bloodtrail",
            "--out",
            str(SHOT_FRAMES.relative_to(ROOT)),
            "--q",
            "90",
        ],
        env=env,
    )
    frames = sorted(SHOT_FRAMES.glob("*.jpg"))
    expected = [SHOT_FRAMES / f"{i:04d}.jpg" for i in range(1, SHOT_FRAMES_COUNT + 1)]
    if frames != expected:
        raise RuntimeError(f"bloodtrail frame set is not exactly 210 frames: {len(frames)}")


def replace_insert_frames() -> None:
    if not FULL_FRAMES.is_dir():
        raise FileNotFoundError(FULL_FRAMES)
    for offset in range(SHOT_FRAMES_COUNT):
        source = SHOT_FRAMES / f"{offset + 1:04d}.jpg"
        target = FULL_FRAMES / f"{INSERT_START + offset:04d}.jpg"
        if not source.is_file() or not target.is_file():
            raise FileNotFoundError(source if not source.is_file() else target)
        shutil.copyfile(source, target)
    print(f"replaced composition frames {INSERT_START}..{INSERT_START + SHOT_FRAMES_COUNT - 1}")


def make_audio() -> None:
    # Keep the original voice/music before the cut and after the cut byte-for-
    # byte at the filter input; only the seven-second insert is generated.
    run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-i",
            str(ORIGINAL),
            "-filter_complex",
            (
                "[0:a]atrim=start=0:end=42.28,asetpts=PTS-STARTPTS[a0];"
                "[0:a]atrim=start=42.28:end=60,asetpts=PTS-STARTPTS[a1];"
                "anoisesrc=color=brown:seed=7:sample_rate=44100:duration=7:amplitude=0.025,"
                "highpass=f=90,lowpass=f=1400,"
                "afade=t=in:st=0:d=0.35,afade=t=out:st=6.55:d=0.45[wind];"
                "[a0][wind][a1]concat=n=3:v=0:a=1[out]"
            ),
            "-map",
            "[out]",
            "-ar",
            "44100",
            "-ac",
            "1",
            "-c:a",
            "pcm_s16le",
            str(FULL_AUDIO),
        ]
    )
    run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "anoisesrc=color=brown:seed=7:sample_rate=44100:duration=7:amplitude=0.025,"
            "highpass=f=90,lowpass=f=1400,afade=t=in:st=0:d=0.35,afade=t=out:st=6.55:d=0.45",
            "-ar",
            "44100",
            "-ac",
            "1",
            "-c:a",
            "pcm_s16le",
            str(WIND_AUDIO),
        ]
    )


def encode() -> None:
    run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-framerate",
            "30",
            "-i",
            str(FULL_FRAMES / "%04d.jpg"),
            "-i",
            str(FULL_AUDIO),
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            "-shortest",
            str(FULL_OUTPUT),
        ]
    )
    run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-framerate",
            "30",
            "-i",
            str(SHOT_FRAMES / "%04d.jpg"),
            "-i",
            str(WIND_AUDIO),
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            "-shortest",
            str(CLIP_OUTPUT),
        ]
    )


def validate() -> None:
    for path, expected in ((FULL_OUTPUT, 67.0), (CLIP_OUTPUT, 7.0)):
        info = ffprobe(path)
        duration = float(info["format"]["duration"])
        if abs(duration - expected) > 0.02:
            raise RuntimeError(f"{path} duration {duration} != {expected}")
        streams = info["streams"]
        if len(streams) != 2 or streams[0]["codec_type"] != "video" or streams[1]["codec_type"] != "audio":
            raise RuntimeError(f"unexpected streams in {path}: {streams}")
        if streams[0]["width"] != 1080 or streams[0]["height"] != 1920 or streams[0]["r_frame_rate"] != "30/1":
            raise RuntimeError(f"unexpected video stream in {path}: {streams[0]}")
        print(path.relative_to(ROOT), info["format"], streams)
        run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "null", "-"])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default=os.environ.get("BASE", "http://127.0.0.1:53750"))
    args = parser.parse_args()
    prompt = (PROMO / "film.html").read_text(encoding="utf-8")
    if "<kbd>G</kbd>靠近查看死因" not in prompt:
        raise RuntimeError("film.html does not contain the final G-key bloodtrail prompt")
    render_shot(args.base)
    replace_insert_frames()
    make_audio()
    encode()
    validate()
    print("PASS: bloodtrail re-render, exact frame replacement, shifted audio, and both MP4 decode checks")


if __name__ == "__main__":
    main()
