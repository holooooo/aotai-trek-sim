"""Voiceover: one local MamboTTS call per subtitle line (exact line timings).
usage: python3 promo/voice.py [--speed 1.08]  ->  promo/build/voice.wav + promo/timeline.js
Long pauses inside a line (TTS stalls at commas) are squeezed to <= 0.22 s."""
import json, os, subprocess, sys, wave
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "build")
CACHE = os.path.join(OUT, "tts")
os.makedirs(CACHE, exist_ok=True)
SR = 44100
SPEED = float(sys.argv[sys.argv.index("--speed") + 1]) if "--speed" in sys.argv else 1.08
START, LINE_GAP, SEG_GAP, TAIL = 0.5, 0.16, 0.55, 3.6
MAX_PAUSE = 0.22
# extra hold after a segment so the visuals can land (seconds)
HOLD = {"hook": 0.35, "setting": 0.2, "roles": 0.25, "cold": 0.3, "storm": 0.25, "reveal": 0.4}
SPOKEN = [("2018年", "二零一八年"), ("46人", "四十六人")]


def spoken(t):
    for a, b in SPOKEN:
        t = t.replace(a, b)
    return t


def tts(key, text, take=1):
    if take > 1:
        key += f"_t{take}"
    wav, meta = os.path.join(CACHE, key + ".wav"), os.path.join(CACHE, key + ".txt")
    tag = f"{SPEED}|{text}"
    if os.path.exists(wav) and os.path.exists(meta) and open(meta, encoding="utf-8").read() == tag:
        return wav
    if os.path.exists(wav):
        os.remove(wav)  # mambo-mac never overwrites; it appends _1
    subprocess.run(["mambo-mac", "say", "--voice", "manbo", "--speed", str(SPEED), "-q", text, "-o", wav], check=True)
    open(meta, "w", encoding="utf-8").write(tag)
    return wav


def load(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"],
                         capture_output=True, check=True).stdout
    d = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768
    idx = np.where(np.abs(d) > 0.012)[0]
    return d[max(0, idx[0] - int(0.03 * SR)): idx[-1] + int(0.12 * SR)] if len(idx) else d


def squeeze(d):
    """Shorten silent runs inside the line to MAX_PAUSE (keeps a short crossfade)."""
    win = int(0.01 * SR)
    n = len(d) // win
    e = np.abs(d[: n * win]).reshape(n, win).max(axis=1)
    quiet = e < 0.012
    out, i, last = [], 0, 0
    while i < n:
        if quiet[i]:
            j = i
            while j < n and quiet[j]:
                j += 1
            if (j - i) * 0.01 > MAX_PAUSE and i > 0 and j < n:
                keep = int(MAX_PAUSE / 0.01)
                cut0, cut1 = (i + keep // 2) * win, (j - keep // 2) * win
                out.append(d[last:cut0]); last = cut1
            i = j
        else:
            i += 1
    out.append(d[last:])
    return np.concatenate(out)


WHISPER = os.path.expanduser("~/.cache/whisper.cpp/ggml-large-v3-turbo.bin")


def heard(wav):
    p16 = wav[:-4] + ".16k.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", wav, "-ar", "16000", "-ac", "1", p16], check=True)
    r = subprocess.run(["whisper-cli", "-m", WHISPER, "-l", "zh", "-nt", "-np", p16], capture_output=True, text=True)
    return r.stdout.strip()


def pinyin_ratio(a, b):
    """compare toneless pinyin so whisper's homophone picks (血/雪, 屋/雾) don't count as misreads"""
    import difflib, re
    from pypinyin import lazy_pinyin
    n = lambda s: lazy_pinyin(re.sub(r"[^一-鿿]", "", spoken(s)))
    return difflib.SequenceMatcher(None, n(a), n(b)).ratio()


script = json.load(open(os.path.join(HERE, "script.json"), encoding="utf-8"))
segs = script["segments"]

# --verify [--retake N]: whisper listens to every line; low scores get re-synthesised, best take wins
if "--verify" in sys.argv:
    retake = int(sys.argv[sys.argv.index("--retake") + 1]) if "--retake" in sys.argv else 0
    changed = False
    for seg in segs:
        for li, ln in enumerate(seg["lines"]):
            take = ln.get("take", 1)
            key = f"{seg['id']}_{li}"
            h = heard(tts(key, spoken(ln["text"]), take)); r = pinyin_ratio(ln["text"], h)
            best = (r, take, h)
            k = 0
            while best[0] < 0.8 and k < retake:
                k += 1
                cand = max(take, best[1]) + k
                h2 = heard(tts(key, spoken(ln["text"]), cand)); r2 = pinyin_ratio(ln["text"], h2)
                print(f"    retake {key}#{cand} {r2:.2f} heard: {h2}")
                if r2 > best[0]:
                    best = (r2, cand, h2)
            if best[1] != take:
                ln["take"] = best[1]; changed = True
            print(f"  {'✓' if best[0] >= 0.8 else '✗'} {best[0]:.2f} [{key}#{best[1]}] {ln['text']}\n        heard: {best[2]}")
    if changed:
        json.dump(script, open(os.path.join(HERE, "script.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print("picked takes written back to script.json")
chunks, t, scenes = [np.zeros(int(START * SR), np.float32)], START, []
for si, seg in enumerate(segs):
    s0, lines = t, []
    for li, ln in enumerate(seg["lines"]):
        d = squeeze(load(tts(f"{seg['id']}_{li}", spoken(ln["text"]), ln.get("take", 1))))
        lines.append({"text": ln["text"], "start": round(t, 3), "end": round(t + len(d) / SR, 3), **({"rehook": ln["rehook"]} if "rehook" in ln else {})})
        chunks.append(d); t += len(d) / SR
        last = li == len(seg["lines"]) - 1
        g = ln.get("gap", LINE_GAP) if not last else SEG_GAP + HOLD.get(seg["id"], 0) + (TAIL if si == len(segs) - 1 else 0)
        chunks.append(np.zeros(int(g * SR), np.float32)); t += g
    scenes.append({"id": seg["id"], "start": round(s0, 3), "end": round(t, 3), "lines": lines})
    print(f"{seg['id']:8s} {s0:6.2f} -> {t:6.2f}")
scenes[0]["start"] = 0.0
track = np.concatenate(chunks)
track = track / (np.abs(track).max() + 1e-9) * 0.92
with wave.open(os.path.join(OUT, "voice.wav"), "w") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((track * 32767).astype(np.int16).tobytes())
with open(os.path.join(HERE, "timeline.js"), "w", encoding="utf-8") as f:
    f.write("window.TIMELINE = " + json.dumps({"duration": round(t, 3), "scenes": scenes}, ensure_ascii=False, indent=1) + ";\n")

# pacing self-check: a question / twist / hook at least every `rehookEvery` seconds
marks = [0.0] + [l["start"] for s in scenes for l in s["lines"] if "rehook" in l] + [t - TAIL]
worst = max(b - a for a, b in zip(marks, marks[1:]))
chars = sum(len(l["text"]) for s in scenes for l in s["lines"])
print(f"total {t:.2f}s  chars {chars}  max rehook gap {worst:.1f}s  ({'OK' if worst <= script['rehookEvery'] else 'TOO LONG'})")
