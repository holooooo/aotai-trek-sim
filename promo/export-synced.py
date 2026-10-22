#!/usr/bin/env python3
"""Repair the current 75s cut from one shared narration/subtitle cue sheet.

Does not splice an obsolete mixed CTA back in. First 42.28s and 49.28..59.54s
retain the previous soundtrack exactly; replacement ranges receive fresh voice
and a low wind bed. --audio-only synthesises, fits, mixes and writes QA metadata.
Final encode uses existing composition frames; originals are not overwritten.
"""
from __future__ import annotations
import argparse
import json
import math
import subprocess
import wave
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
PROMO = ROOT / 'promo'
BUILD = PROMO / 'build'
MANIFEST = PROMO / 'narration-fixes.json'
OUTPUT = ROOT / 'aotai_promo_synced.mp4'
AUDIO = BUILD / 'synced_audio_75.wav'
SR = 44100


def run(cmd, **kwargs):
    return subprocess.run(cmd, cwd=ROOT, check=True, **kwargs)


def decode(path):
    p = run(['ffmpeg','-v','error','-i',str(path),'-ar',str(SR),'-ac','1','-f','f32le','-'], capture_output=True)
    return np.frombuffer(p.stdout, np.float32).copy()


def save(path, data):
    with wave.open(str(path),'w') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((np.clip(data,-1,1)*32767).astype(np.int16).tobytes())


def trim_and_squeeze(d):
    active = np.where(np.abs(d) > .012)[0]
    if not len(active):
        raise RuntimeError('empty narration')
    d = d[max(0, active[0]-int(.03*SR)):min(len(d),active[-1]+int(.10*SR))]
    win = int(.01*SR)
    n = len(d)//win
    quiet = np.max(np.abs(d[:n*win].reshape(n,win)),axis=1) < .012
    chunks, i, last = [], 0, 0
    while i<n:
        if quiet[i]:
            j=i
            while j<n and quiet[j]: j+=1
            if j-i>22 and i>0 and j<n:
                a,b=(i+11)*win,(j-11)*win
                chunks.append(d[last:a]);last=b
            i=j
        else: i+=1
    chunks.append(d[last:])
    return np.concatenate(chunks)


def prepare(cue):
    path = PROMO / cue['audio']
    tag = path.with_suffix('.text.txt')
    if cue.get('generate'):
        if path.exists() and (not tag.exists() or tag.read_text() != cue['text']):
            raise RuntimeError(f'stale TTS cache; use a new cue audio filename: {path}')
        if not path.exists():
            run(['mambo-mac','say','--voice','manbo','--speed','1.08','-q',cue['text'],'-o',str(path)])
            tag.write_text(cue['text'])
    d = trim_and_squeeze(decode(path))
    before = len(d)/SR
    slot = cue['end']-cue['start']
    speed = max(1.0, before/slot)
    if speed > 1.32:
        raise RuntimeError(f'{cue["id"]} too long ({before:.2f}s for {slot:.2f}s); shorten copy or re-record')
    if speed > 1:
        d = np.frombuffer(run(['ffmpeg','-v','error','-f','f32le','-ar',str(SR),'-ac','1','-i','-',
            '-af',f'atempo={speed:.8f}','-f','f32le','-'],input=d.astype(np.float32).tobytes(),capture_output=True).stdout,np.float32).copy()
    if len(d)>round(slot*SR):
        # FFmpeg's tempo rounding may add a few milliseconds, but never cut voiced samples.
        tail=d[round(slot*SR):]
        if np.max(np.abs(tail)) > .012: raise RuntimeError(f'{cue["id"]} voiced tail would be truncated')
        d=d[:round(slot*SR)]
    active=d[np.abs(d)>.012]
    gain=float(min(.15/(math.sqrt(float(np.mean(active**2)))+1e-9), .82/(np.max(np.abs(d))+1e-9)))
    d *= gain
    fade=int(.006*SR)
    d[:fade]*=np.linspace(0,1,fade);d[-fade:]*=np.linspace(1,0,fade)
    fitted=BUILD/'tts'/f'{cue["id"]}_synced.wav'
    save(fitted,d)
    return d,dict(id=cue['id'],text=cue['text'],start=cue['start'],end=cue['start']+len(d)/SR,
        subtitleEnd=cue['end'],originalSeconds=before,tempo=speed,gain=gain,rendered=str(fitted.relative_to(ROOT)))


def make_audio():
    spec=json.loads(MANIFEST.read_text())
    n=round(spec['duration']*SR)
    base=decode(ROOT/'aotai_promo_bloodtrail_hook.mp4')
    if len(base)<n: raise RuntimeError('source audio shorter than full cut')
    mix=base[:n].copy()
    rng=np.random.default_rng(27)
    for a,b in spec['replaceRanges']:
        i,j=round(a*SR),round(b*SR)
        # A quiet, stationary low-passed wind bed, never amix auto-normalised.
        raw=rng.standard_normal(j-i).astype(np.float32)
        wind=np.convolve(raw,np.ones(90,dtype=np.float32)/90,mode='same')*.014
        f=min(round(.16*SR),len(wind)//2)
        wind[:f]*=np.linspace(0,1,f);wind[-f:]*=np.linspace(1,0,f)
        mix[i:j]=wind
    # Reuse the clean instrumental stem for the closing card, not the old mixed CTA.
    bed=decode(BUILD/'bed.flac')[round(52.54*SR):round(60*SR)]
    bed *= .022/(math.sqrt(float(np.mean(bed**2)))+1e-9)
    fade=round(.30*SR)
    bed[:fade]*=np.linspace(0,1,fade);bed[-fade:]*=np.linspace(1,0,fade)
    i=round(59.54*SR);mix[i:i+len(bed)]+=bed
    reports=[]
    for cue in spec['cues']:
        d,report=prepare(cue)
        i=round(cue['start']*SR);j=i+len(d)
        if j>round(cue['end']*SR)+1: raise RuntimeError('cue overflow')
        mix[i:j]+=d;reports.append(report)
        print(json.dumps(report,ensure_ascii=False),flush=True)
    if np.max(np.abs(mix))>1: raise RuntimeError('mix clipped')
    # End only after the last word has finished, unlike the previous 73.7s fade.
    f=round(.18*SR);mix[-f:]*=np.linspace(1,0,f)
    save(AUDIO,mix)
    report={'duration':spec['duration'],'cues':reports,'peak':float(np.max(np.abs(mix))),
        'preservedRanges':[[0,42.28],[49.28,59.54]],'replacementRanges':spec['replaceRanges']}
    (BUILD/'synced-audio-qa.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))


def encode():
    frames=BUILD/'frames'/'final'
    if not all((frames/f'{i:04d}.jpg').exists() for i in range(1,2251)): raise RuntimeError('incomplete frames')
    run(['ffmpeg','-y','-v','error','-framerate','30','-i',str(frames/'%04d.jpg'),'-i',str(AUDIO),
        '-map','0:v:0','-map','1:a:0','-frames:v','2250','-c:v','libx264','-preset','medium','-crf','18',
        '-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart','-shortest',str(OUTPUT)])
    p=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries',
        'format=duration,size:stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels,duration','-of','json',str(OUTPUT)]))
    assert abs(float(p['format']['duration'])-75)<.02,p
    v,a=p['streams']
    assert v['width']==1080 and v['height']==1920 and v['r_frame_rate']=='30/1',p
    assert a['codec_type']=='audio' and a['sample_rate']=='44100',p
    run(['ffmpeg','-v','error','-i',str(OUTPUT),'-f','null','-'])
    print(json.dumps(p,indent=2));print('PASS: synced 75s film encoded and fully decoded')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--audio-only',action='store_true');parser.add_argument('--encode-only',action='store_true')
    args=parser.parse_args()
    if not args.encode_only: make_audio()
    if not args.audio_only: encode()
