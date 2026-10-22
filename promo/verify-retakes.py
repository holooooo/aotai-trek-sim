#!/usr/bin/env python3
"""Generate/cache alternate local TTS takes, ASR check, select best cue."""
import difflib,json,re,subprocess,hashlib
from pathlib import Path
from pypinyin import lazy_pinyin
ROOT=Path(__file__).resolve().parent.parent
manifest=ROOT/'promo/narration-fixes.json'
spec=json.loads(manifest.read_text())
changes={
 'bloodtrail_0':'路上还有你和其他玩家的血迹。',
 'bloodtrail_1':'靠近就能查看死因，血迹也能随时关闭。',
 'cta_1':'想玩的话，评论区有链接。',
 'tail_hook_1':'手机就能玩，但主播还没通关。大佬们，评论区分享技巧呀！',
}
model=Path.home()/'.cache/whisper.cpp/ggml-large-v3-turbo.bin'
report=[]
def norm(t):return lazy_pinyin(re.sub('[^一-鿿]','',t))
for cue in spec['cues']:
 if cue['id'] not in changes:continue
 text=changes[cue['id']];best=None
 for take in range(1,5):
  rel=f'build/tts/verified_{cue["id"]}_{hashlib.sha256(text.encode()).hexdigest()[:8]}_t{take}.wav';wav=ROOT/'promo'/rel
  if not wav.exists():subprocess.run(['mambo-mac','say','--voice','manbo','--speed','1.08','-q',text,'-o',str(wav)],check=True)
  w16=wav.with_suffix('.16k.wav')
  subprocess.run(['ffmpeg','-v','error','-y','-i',str(wav),'-ac','1','-ar','16000',str(w16)],check=True)
  r=subprocess.run(['whisper-cli','-m',str(model),'-l','zh','-nt','-np',str(w16)],capture_output=True,text=True,check=True)
  heard=r.stdout.strip();ratio=difflib.SequenceMatcher(None,norm(text),norm(heard)).ratio()
  item={'id':cue['id'],'text':text,'take':take,'heard':heard,'ratio':ratio,'audio':rel}
  print(json.dumps(item,ensure_ascii=False),flush=True)
  if best is None or ratio>best['ratio']:best=item
  if ratio>=.93:break
 report.append(best)
 if best['ratio']<.88:raise RuntimeError(f'No clean TTS take: {best}')
 cue.update(text=text,audio=best['audio'],generate=False)
manifest.write_text(json.dumps(spec,ensure_ascii=False,indent=2)+'\n')
(ROOT/'output/promo-audit/retake-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
