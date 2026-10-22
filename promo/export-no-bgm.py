#!/usr/bin/env python3
"""Build the synced film without BGM from clean voice + procedural effects.

Never attempts source separation or phase subtraction from a mixed soundtrack.
Both old-cut narration/effects and repaired cues are independently available.
Video packets are copied verbatim from the latest synced picture edit.
"""
from __future__ import annotations
import json
import os
import subprocess
from pathlib import Path
import numpy as np

ROOT=Path(__file__).resolve().parent.parent
PROMO=ROOT/'promo'
BUILD=PROMO/'build'
SR=44100
DURATION=75


def run(cmd,**kwargs):
    return subprocess.run(cmd,cwd=ROOT,check=True,**kwargs)


def decode(path):
    return np.frombuffer(run(['ffmpeg','-v','error','-i',str(path),'-ac','1','-ar',str(SR),'-f','f32le','-'],capture_output=True).stdout,np.float32).copy()


def save(path,d):
    run(['ffmpeg','-y','-v','error','-f','f32le','-ar',str(SR),'-ac','1','-i','-','-c:a','pcm_f32le',str(path)],input=d.astype(np.float32).tobytes())


def video_hash(path):
    return run(['ffmpeg','-v','error','-i',str(path),'-map','0:v:0','-c','copy','-f','hash','-hash','sha256','-'],capture_output=True,text=True).stdout.strip()


def build():
    env=os.environ.copy();env.update(STEMS_ONLY='1',VOICE_PATH=str(BUILD/'voice_final.wav'))
    run(['python3','promo/sfx.py'],env=env)
    original_voice=decode(BUILD/'voice_stem.wav')
    original_sfx=decode(BUILD/'sfx_stem.wav')
    voice=np.zeros(DURATION*SR,np.float32);sfx=voice.copy()
    # Original mixed film measured ~5ms processing latency; keep new narration aligned.
    offset=round(.00494*SR)
    for src,target in ((original_voice,voice),(original_sfx,sfx)):
        delayed=np.pad(src,(offset,0))
        for a,b,dest in ((0,42.28,0),(42.28,52.54,49.28)):
            i,j,k=round(a*SR),round(b*SR),round(dest*SR)
            target[k:k+j-i]=delayed[i:j]
    spec=json.loads((PROMO/'narration-fixes.json').read_text())
    qa=json.loads((BUILD/'synced-audio-qa.json').read_text())
    assert len(qa['cues'])==len(spec['cues'])
    cues=[]
    for cue,measured in zip(spec['cues'],qa['cues']):
        assert cue['id']==measured['id'] and cue['text']==measured['text'] and cue['start']==measured['start']
        d=decode(ROOT/measured['rendered'])
        i=round(cue['start']*SR);j=i+len(d)
        assert j<=round(cue['end']*SR)+1
        voice[i:j]+=d
        cues.append(dict(id=cue['id'],start=cue['start'],end=j/SR,text=cue['text'],source=measured['rendered']))
    # Match restrained wind under the repaired bloodtrail and closing passages.
    rng=np.random.default_rng(27)
    for a,b in spec['replaceRanges']:
        i,j=round(a*SR),round(b*SR)
        raw=rng.standard_normal(j-i).astype(np.float32)
        wind=np.convolve(raw,np.ones(90,dtype=np.float32)/90,mode='same')*.014
        f=round(.16*SR)
        wind[:f]*=np.linspace(0,1,f);wind[-f:]*=np.linspace(1,0,f)
        sfx[i:j]=wind
    # End after the final spoken phrase, leaving its full tail intact.
    f=round(.18*SR)
    voice[-f:]*=np.linspace(1,0,f);sfx[-f:]*=np.linspace(1,0,f)
    mix=voice+sfx
    gain=min(1.,.90/float(np.max(np.abs(mix))))
    voice*=gain;sfx*=gain;mix=voice+sfx
    save(BUILD/'no_bgm_voice_75.wav',voice)
    save(BUILD/'no_bgm_sfx_75.wav',sfx)
    save(BUILD/'no_bgm_audio_75.wav',mix)
    # This exact identity proves no other source, including music, enters the mix.
    residual=decode(BUILD/'no_bgm_audio_75.wav')-decode(BUILD/'no_bgm_voice_75.wav')-decode(BUILD/'no_bgm_sfx_75.wav')
    assert float(np.max(np.abs(residual)))<1e-6
    report=dict(duration=75,bgmIncluded=False,musicSources=[],masterGain=gain,
        peak=float(np.max(np.abs(mix))),stemResidualPeak=float(np.max(np.abs(residual))),
        oldNarrationOffsetSeconds=offset/SR,cues=cues,
        voiceSource='promo/build/voice_final.wav',effectsSource='promo/sfx.py:STEMS_ONLY',
        sourceSegments=[[0,42.28,0],[42.28,52.54,49.28]])
    (BUILD/'no-bgm-qa.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    return report


def encode(source,output):
    run(['ffmpeg','-y','-v','error','-i',str(source),'-i',str(BUILD/'no_bgm_audio_75.wav'),
        '-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','128k','-movflags','+faststart','-t','75',str(output)])
    source_hash=video_hash(source);out_hash=video_hash(output)
    assert source_hash==out_hash,'picture edit changed'
    info=json.loads(run(['ffprobe','-v','error','-show_entries',
        'format=duration,size:stream=codec_type,width,height,r_frame_rate,sample_rate,duration','-of','json',str(output)],capture_output=True,text=True).stdout)
    assert abs(float(info['format']['duration'])-75)<.02
    video,audio=info['streams']
    assert video['width']==1080 and video['height']==1920 and video['r_frame_rate']=='30/1'
    assert audio['sample_rate']=='44100' and abs(float(audio['duration'])-75)<.02
    run(['ffmpeg','-v','error','-i',str(output),'-f','null','-'])
    print(json.dumps(dict(output=str(output.relative_to(ROOT)),pictureHash=out_hash,probe=info),ensure_ascii=False),flush=True)
    return dict(file=str(output.relative_to(ROOT)),pictureHash=out_hash,probe=info)


if __name__=='__main__':
    report=build()
    report['outputs']=[encode(ROOT/'aotai_promo_synced.mp4',ROOT/'aotai_promo_synced_no_bgm.mp4')]
    portable=ROOT/'aotai_promo_synced_lark.mp4'
    if portable.exists():
        result=encode(portable,ROOT/'aotai_promo_synced_no_bgm_lark.mp4')
        assert int(result['probe']['format']['size'])<30_000_000
        report['outputs'].append(result)
    (BUILD/'no-bgm-qa.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print('PASS: no music source loaded; clean voice + effects sum verified; identical picture packets; full decode; portable version under 30MB')
