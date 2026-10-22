"""SFX + final mix for the promo.
usage: python3 promo/sfx.py   ->  promo/build/mix.wav  (-15 LUFS, -1.5 dBTP)
Layers: voice (build/voice.wav) + bed (build/bed.flac, ducked under speech) + procedural SFX.
"""
import os, subprocess
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
B = os.path.join(HERE, "build")
SR = 44100
DUR = 59.988
N = int(DUR * SR)
rng = np.random.default_rng(7)


def env_adsr(n, a=0.01, d=0.05, s=0.6, r=0.1):
    e = np.ones(n)
    na, nd, nr = int(a * SR), int(d * SR), int(r * SR)
    e[:na] = np.linspace(0, 1, na)
    e[na:na + nd] = np.linspace(1, s, nd)
    e[-nr:] *= np.linspace(1, 0, nr)
    return e


def noise(n):
    return rng.standard_normal(n).astype(np.float32)


def tone(n, f, harmonics=(1, 0.5, 0.25)):
    t = np.arange(n) / SR
    y = sum(a * np.sin(2 * np.pi * f * k * t) for k, a in enumerate(harmonics, 1))
    return y.astype(np.float32)


def place(buf, t, clip, gain=1.0):
    i = int(t * SR)
    j = min(N, i + len(clip))
    if 0 <= i < N:
        buf[i:j] += clip[: j - i] * gain


# —— 音效 ——
sfx = np.zeros(N, np.float32)

# 呼呼的风：全程低噪，风暴段抬高
wind_base = np.zeros(N, np.float32)
w = noise(N)
# 简单一阶低通
for a in (0.985, 0.99, 0.995):
    y = np.empty_like(w); acc = 0.0
    for i in range(N):
        acc = a * acc + (1 - a) * w[i]; y[i] = acc
    w = y
mod = 0.6 + 0.4 * np.sin(2 * np.pi * 0.17 * np.arange(N) / SR)
wind_base += w * mod
def ramp(t0, t1, v0, v1):
    g = np.zeros(N); i0, i1 = int(t0 * SR), int(t1 * SR)
    g[i1:] = v1
    g[i0:i1] = np.linspace(v0, v1, i1 - i0)
    return g
wg = np.full(N, 0.10)
for t0, t1, v in [(0, 5.14, 0.55), (9.7, 12.0, 0.30), (30.4, 33.5, 0.85), (33.4, 36.6, 1.0), (36.4, 42.3, 0.45)]:
    i0, i1 = int(t0 * SR), int(t1 * SR); wg[i0:i1] = np.maximum(wg[i0:i1], v)
wg *= np.linspace(0, 1, int(0.4 * SR)).tolist() + [1] * (N - int(0.4 * SR))
sfx += wind_base / (np.max(np.abs(wind_base)) + 1e-9) * wg * 0.9

# 脚步：雪地软脚步（低频噪声脉冲）
def foot(n=int(0.16 * SR)):
    c = noise(n) * env_adsr(n, 0.004, 0.03, 0.2, 0.09)
    acc = 0.0
    for i in range(n):
        acc = 0.94 * acc + 0.06 * c[i]; c[i] = acc
    return c * 3.2
for span, step in [((0.3, 1.9), 0.52), ((5.2, 7.3), 0.5), ((30.7, 31.6), 0.5), ((33.6, 36.3), 0.62),
                   ((36.6, 39.4), 0.66), ((46.2, 47.2), 0.5)]:
    t = span[0]
    while t < span[1]:
        place(sfx, t, foot(), 0.5); t += step

# 阵风冲击 31.76（镜头里 gust.hit=1.1 -> 30.66+1.1）
whoosh_n = int(0.9 * SR)
wh = noise(whoosh_n)
acc = 0.0
for i in range(whoosh_n):
    acc = 0.97 * acc + 0.03 * wh[i]; wh[i] = acc
wh *= np.sin(np.linspace(0, np.pi, whoosh_n)) ** 1.4 * 2.6
place(sfx, 31.66, wh, 0.8)

# 键盘：按住空格 32.51
key_n = int(0.09 * SR)
key = tone(key_n, 190, (1, 0.3)) * env_adsr(key_n, 0.001, 0.02, 0.1, 0.05) * 0.5
key += noise(key_n) * env_adsr(key_n, 0.001, 0.01, 0, 0.02) * 0.3
place(sfx, 32.45, key, 0.7)
place(sfx, 32.62, key * 0.6, 0.5)

# 烤肠摊的滋滋声：暖光亮着的时候（36.5-41.0）
zz_n = int(4.4 * SR)
zz = noise(zz_n)
acc = 0.0
for i in range(zz_n):
    acc = 0.6 * acc + 0.4 * zz[i]; zz[i] = zz[i] - acc   # 高通
zz *= (0.5 + 0.5 * np.sin(2 * np.pi * 9 * np.arange(zz_n) / SR)) * 0.33
place(sfx, 36.7, zz, 0.6)

# 戳戳章：禁止穿越 9.85、永远售罄 21.75、最佳结局 44.6
def stamp(n=int(0.22 * SR)):
    c = noise(n) * env_adsr(n, 0.001, 0.02, 0.15, 0.12)
    acc = 0.0
    for i in range(n):
        acc = 0.9 * acc + 0.1 * c[i]; c[i] = acc
    return c * 4
for ts in (9.82, 21.72, 44.55, 50.6):
    place(sfx, ts, stamp(), 0.55)

# 计数器咔哒：46 的数字滚动 7.5-8.3
click_n = int(0.025 * SR)
click = tone(click_n, 1400, (1, 0.2)) * env_adsr(click_n, 0.001, 0.006, 0, 0.01)
for i in range(9):
    place(sfx, 7.5 + i * 0.09, click, 0.28)

# 白闪的"嗖"：转场 1.95 / 7.41 / 33.46 / 42.28 / 50.37
def riser(n=int(0.16 * SR)):
    t = np.arange(n) / SR
    f = np.linspace(300, 1800, n)
    return (np.sin(2 * np.pi * np.cumsum(f) / SR) * np.linspace(0, 1, n) * np.linspace(1, 0, n)).astype(np.float32) * 0.4
for ts in (1.93, 7.39, 33.44, 42.26, 50.35):
    place(sfx, ts, riser(), 0.45)

# 片尾弹出 52.7 / 53.4 / 54.1 / 55.0
blip_n = int(0.12 * SR)
blip = tone(blip_n, 660, (1, 0.4, 0.15)) * env_adsr(blip_n, 0.004, 0.03, 0.3, 0.06)
for i, ts in enumerate((52.75, 53.45, 54.15, 54.95)):
    place(sfx, ts, tone(blip_n, 600 + i * 70, (1, 0.35)) * env_adsr(blip_n, 0.004, 0.03, 0.3, 0.06), 0.22)

peak = np.max(np.abs(sfx))
sfx *= 0.9 / peak

# —— 读取旁白与配乐 ——
def load(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


voice = load(os.environ.get("VOICE_PATH", os.path.join(B, "voice.wav")))[:N]

# 旁白响度归一到 -16.5 LUFS 量级：用 RMS 近似
def rms(x):
    return np.sqrt(np.mean(x ** 2) + 1e-12)
voice *= 0.11 / rms(voice[int(0.5 * SR):])

# 无BGM版只取干净分轨，绝不从已含音乐的混音中做消除。
if os.environ.get("STEMS_ONLY") == "1":
    for name, data in (("voice_stem.wav", voice), ("sfx_stem.wav", sfx * 0.5)):
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-",
                        "-c:a", "pcm_f32le", os.path.join(B, name)], input=data.astype(np.float32).tobytes(), check=True)
    print("voice_stem.wav + sfx_stem.wav ready; no music file loaded")
    raise SystemExit(0)

bed = load(os.path.join(B, "bed.flac"))
bed = bed[:N] if len(bed) >= N else np.pad(bed, (0, N - len(bed)))
bed *= 0.045 / rms(bed)

# 闪避：说话时把配乐压低 7 dB，120ms 攻击 / 释放
win = int(0.02 * SR)
env = np.array([np.sqrt(np.mean(voice[i:i + win] ** 2)) for i in range(0, N, win)])
talk = env > np.max(env) * 0.08
duck = np.ones_like(env)
att, rel = 0.25, 0.06
for i in range(1, len(duck)):
    target = 0.42 if talk[i] else 1.0
    a = att if target < duck[i - 1] else rel
    duck[i] = duck[i - 1] + a * (target - duck[i - 1])
duck = np.repeat(duck, win)[:N]
# 片尾卡（52.5s 后）配乐回来并稍抬
duck = np.where(np.arange(N) > 52.6 * SR, np.maximum(duck, 0.85), duck)
# 前 0.4s 淡入
duck[:int(0.4 * SR)] *= np.linspace(0, 1, int(0.4 * SR))

mix = voice + bed * duck + sfx * 0.5
# 淡出结尾
mix[-int(1.2 * SR):] *= np.linspace(1, 0, int(1.2 * SR))

peak = np.max(np.abs(mix))
mix *= min(1.0, 0.89 / peak)
out = os.path.join(B, "mix_raw.wav")
subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-",
                "-c:a", "pcm_s16le", out], input=mix.astype(np.float32).tobytes(), check=True)
subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", out, "-af", "loudnorm=I=-15:TP=-1.5:LRA=11",
                "-c:a", "pcm_s16le", "-ar", str(SR), os.environ.get("MIX_PATH", os.path.join(B, "mix.wav"))], check=True)
print("mix.wav ready")
