import json, subprocess, wave, math
from pathlib import Path
P=Path(__file__).parent
scenes=json.loads((P/'scenes.json').read_text())
rate=24000; channels=1; sw=2
for scene in scenes:
 chunks=[b'\0'*(int(.4*rate)*sw)]; captions=[];t=.4
 for j,line in enumerate(scene['lines']):
  stem=P/'audio'/f"{scene['id']}-{j:02d}"
  aiff=stem.with_suffix('.aiff'); wav=stem.with_suffix('.wav')
  if not wav.exists():
   subprocess.run(['say','-v','Samantha','-r','173','-o',str(aiff),line],check=True)
   subprocess.run(['ffmpeg','-v','error','-y','-i',str(aiff),'-ar',str(rate),'-ac','1',str(wav)],check=True)
  with wave.open(str(wav)) as w:
   data=w.readframes(w.getnframes());dur=len(data)/sw/rate
  captions.append({'start':t,'end':t+dur,'text':line});chunks.append(data);t+=dur
  gap=.27;chunks.append(b'\0'*(int(gap*rate)*sw));t+=gap
 tail=.65;chunks.append(b'\0'*(int(tail*rate)*sw));t+=tail
 frames=math.ceil(t*24); pad=frames/24-t
 chunks.append(b'\0'*(int(pad*rate)*sw))
 scene['duration']=frames/24;scene['frames']=frames;scene['captions']=captions
 dest=P/'audio'/f"{scene['id']}.wav"
 with wave.open(str(dest),'wb') as w:
  w.setnchannels(1);w.setsampwidth(2);w.setframerate(rate);w.writeframes(b''.join(chunks))
 print(scene['id'],round(scene['duration'],2),flush=True)
(P/'timeline.json').write_text(json.dumps(scenes,indent=2))
print('TOTAL',sum(s['duration'] for s in scenes),flush=True)
