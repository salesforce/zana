"""Local neural narration; original demo audio remains untouched."""
import hashlib
import json
import subprocess
import wave
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

ROOT=Path(__file__).resolve().parent
CACHE=ROOT.parent/'demo-voice-cache'
DURATION=130
RATE=24000
VOICE='af_heart'
SPEED=0.90
cues=json.loads((ROOT/'narration.json').read_text())
kokoro=Kokoro(str(CACHE/'kokoro-v1.0.onnx'),str(CACHE/'voices-v1.0.bin'))
audio=np.zeros(RATE*DURATION,dtype=np.float32)
captions=[]
report=[]

def stamp(seconds,vtt=False):
    ms=round(seconds*1000)
    h,rest=divmod(ms,3600000);m,rest=divmod(rest,60000);s,ms=divmod(rest,1000)
    return f'{h:02}:{m:02}:{s:02}{"." if vtt else ","}{ms:03}'

for i,cue in enumerate(cues):
    # Pronunciation is separate from the visible caption.
    spoken=cue['text'].replace('Zana','Zahna').replace('GUS','Gus')
    digest=hashlib.sha256(f'{VOICE}/{SPEED}/{spoken}'.encode()).hexdigest()[:12]
    clip=ROOT/'audio'/f'{i:02}-{digest}.wav'
    if clip.exists():
        samples,rate=sf.read(clip,dtype='float32')
    else:
        samples,rate=kokoro.create(spoken,voice=VOICE,speed=SPEED,lang='en-us')
        assert rate==RATE
        # Keep a small natural breath around speech; remove long generated tails.
        voiced=np.flatnonzero(np.abs(samples)>.002)
        if len(voiced): samples=samples[max(0,voiced[0]-int(.04*RATE)):min(len(samples),voiced[-1]+int(.14*RATE))]
        sf.write(clip,samples,rate,subtype='PCM_16')
    assert rate==RATE and len(samples)>RATE*.2
    duration=len(samples)/RATE
    next_start=cues[i+1]['start'] if i+1<len(cues) else DURATION-.3
    available=next_start-cue['start']-.2
    if duration>available:
        raise ValueError(f'Phrase {i} needs a shorter script or more room: {duration:.2f}s > {available:.2f}s')
    offset=round(cue['start']*RATE)
    audio[offset:offset+len(samples)]=samples
    end=min(cue['start']+duration+.28,next_start-.1)
    captions.append({**cue,'end':round(end,3)})
    report.append({'index':i,'duration':round(duration,3),'window':round(available,3),'voice':VOICE,'speed':SPEED,'timeStretch':False})
    print(f'{i:02} {cue["start"]:6.2f}–{end:6.2f} {duration:.2f}s / {available:.2f}s',flush=True)

sf.write(ROOT/'audio/narration.wav',audio,RATE,subtype='PCM_16')
subprocess.run(['ffmpeg','-v','error','-y','-i',str(ROOT/'audio/narration.wav'),'-af','loudnorm=I=-16:TP=-1.5:LRA=11','-ar','48000','-c:a','aac','-b:a','160k',str(ROOT/'audio/narration.m4a')],check=True)
(ROOT/'captions.js').write_text('globalThis.DemoCaptions = '+json.dumps(captions,ensure_ascii=False,indent=2)+';\n')
(ROOT/'captions.srt').write_text('\n\n'.join(f'{i+1}\n{stamp(c["start"])} --> {stamp(c["end"])}\n{c["text"]}' for i,c in enumerate(captions))+'\n')
(ROOT/'captions.vtt').write_text('WEBVTT\n\n'+'\n\n'.join(f'{stamp(c["start"],True)} --> {stamp(c["end"],True)}\n{c["text"]}' for c in captions)+'\n')
(ROOT/'narration.md').write_text('# Shorter Zana walkthrough\n\nAI narration: Kokoro af_heart, generated locally.\n\n'+'\n\n'.join(f'**{stamp(c["start"],True)[:8]}** {c["text"]}' for c in captions)+'\n')
(ROOT/'render/audio-report.json').write_text(json.dumps(report,indent=2)+'\n')
subprocess.run(['ffmpeg','-v','error','-y','-i',str(ROOT/'audio/narration.m4a'),'-t','13','-c','copy',str(ROOT/'voice-preview.m4a')],check=True)
