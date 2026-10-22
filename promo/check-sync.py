#!/usr/bin/env python3
"""Regression checks for the 75-second revised narration/caption time line."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = json.loads((ROOT/'promo/narration-fixes.json').read_text())
qa = json.loads((ROOT/'promo/build/synced-audio-qa.json').read_text())
assert spec['duration'] == qa['duration'] == 75
assert len(spec['cues']) == len(qa['cues']) == 6
previous = 0
for cue, measured in zip(spec['cues'],qa['cues']):
    assert cue['start'] >= previous, cue
    assert cue['start'] < cue['end'] <= 75, cue
    assert any(a <= cue['start'] < cue['end'] <= b for a,b in spec['replaceRanges']), cue
    assert measured['id'] == cue['id'] and measured['text'] == cue['text'], measured
    assert measured['start'] == cue['start'] and measured['end'] <= cue['end'] + 1/44100, measured
    assert measured['tempo'] <= 1.32 and measured['end'] > cue['start'] + .8, measured
    assert '扫码' not in cue['text'],cue
    previous = cue['end']
assert qa['peak'] <= 1
assert any('血迹' in c['text'] for c in spec['cues'])
assert any('评论区' in c['text'] for c in spec['cues'])
compose = (ROOT/'promo/compose.js').read_text()
assert "import narrationFixes from './narration-fixes.json'" in compose
assert '...narrationFixes.cues.map' in compose
assert '扫码' not in (ROOT/'promo/script.json').read_text()
print('PASS: narration/subtitle share one manifest, every cue is inside its scene, no overlap/truncation, bloodtrail voice and comment CTA present, no old QR copy, no clipping')
