import json,subprocess,zipfile,shutil
from pathlib import Path
from PIL import Image
P=Path(__file__).parent
scenes=json.loads((P/'timeline.json').read_text())
meta=[';FFMETADATA1','title=Zana — Projects, Agents, GUS and Plugins','artist=Zana','comment=Narrated walkthrough with edited app captures and illustrative GUS ticket data.']
groups=[]
for s in scenes:
 if not groups or groups[-1]['chapter']!=s['chapter']:groups.append({'chapter':s['chapter'],'start':s['start']})
labels=['Welcome to Zana','Create a project','Launch an agent','Monitor the work','Follow your GUS tickets','Create your own plugins','Start with a goal']
for i,g in enumerate(groups):
 end=groups[i+1]['start'] if i+1<len(groups) else sum(s['duration'] for s in scenes)
 meta.extend(['[CHAPTER]','TIMEBASE=1/1000',f'START={round(g["start"]*1000)}',f'END={round(end*1000)}',f'title={labels[g["chapter"]]}'])
(P/'metadata.txt').write_text('\n'.join(meta)+'\n')
tmp=P/'Zana-demo-final.mp4'
subprocess.run(['ffmpeg','-v','error','-y','-i',str(P/'Zana-demo.mp4'),'-i',str(P/'metadata.txt'),'-map_metadata','1','-map_chapters','1','-c:v','copy','-c:a','aac','-ar','48000','-b:a','160k','-movflags','+faststart',str(tmp)],check=True)
tmp.replace(P/'Zana-demo.mp4')
Image.open(P/'frames/00-intro.png').convert('RGB').save(P/'thumbnail.jpg',quality=92)
buttons=''.join(f'<button data-time="{g["start"]}"><span>{int(g["start"]//60)}:{int(g["start"]%60):02d}</span>{labels[g["chapter"]]}</button>' for g in groups)
html='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Zana — Product walkthrough</title><style>*{box-sizing:border-box}body{margin:0;background:#0b1322;color:#e8effb;font:16px system-ui,sans-serif}main{max-width:1180px;margin:48px auto;padding:0 24px}h1{font-size:36px;margin-bottom:8px}p{color:#afbdd2;line-height:1.6}video{width:100%;border-radius:14px;background:#111b2a;margin:22px 0}nav{display:flex;gap:10px;flex-wrap:wrap}button,a{border:1px solid #31435f;background:#17263e;color:#e8effb;border-radius:8px;padding:12px 16px;font:inherit;cursor:pointer}button span{color:#79e2ce;margin-right:9px}button:hover,a:hover{background:#243b59}button:focus-visible,a:focus-visible{outline:3px solid #79e2ce;outline-offset:4px}.downloads{display:flex;gap:12px;margin:26px 0}a{text-decoration:none}.note{font-size:13px;max-width:820px}</style><main><h1>Your work. One command center.</h1><p>A 2:27 tour of projects, agents, monitoring, GUS tickets, and custom plugins in Zana.</p><video id="demo" controls playsinline preload="metadata" poster="thumbnail.jpg"><source src="Zana-demo.mp4" type="video/mp4"><track kind="subtitles" label="English (optional; captions also appear in the video)" srclang="en" src="captions.vtt"></video><nav aria-label="Video chapters">'''+buttons+'''</nav><div class="downloads"><a href="Zana-demo.mp4" download>Download MP4</a><a href="captions.srt" download>Download subtitles</a></div><p class="note">Captured from the app and edited with close-ups, chapter markers, and locally generated English narration. GUS data regions use labeled fictional examples. Captions are included in the picture for silent viewing.</p></main><script>const v=document.getElementById('demo');document.querySelectorAll('button[data-time]').forEach(b=>b.addEventListener('click',()=>{v.currentTime=Number(b.dataset.time);v.play()}));</script></html>'''
(P/'watch.html').write_text(html)
readme='''# Zana demo video

**2:27 · 1080p · English narration · captions included**

[Download or play the MP4](Zana-demo.mp4) · [Local player with chapters](watch.html) · [Subtitles](captions.srt)

![Zana walkthrough](thumbnail.jpg)

## Covered workflows

'''
for g in groups:
 readme+=f'- {int(g["start"]//60)}:{int(g["start"]%60):02d} — {labels[g["chapter"]]}\n'
readme+='''
## Sharing

Share `Zana-demo.mp4` directly. It uses H.264 video and AAC audio and includes captions in the picture. `Zana-demo-share.zip` includes the video, thumbnail, subtitles, narration, and local player. Extract the archive before opening `watch.html`.

Suggested message:

> A quick tour of Zana: create a project, launch an AI agent, monitor its progress, follow your GUS tickets, and build custom plugins.

## Production notes

- Actual app captures for the project, agent, monitoring, and plugin workflows. Edited still captures use gentle motion and close-ups; this is not an uninterrupted screen recording.
- The task-dashboard agent really created `PLAN.md` in `/Users/Shared/zana-demo-project`.
- GUS data regions were reconstructed with fictional ticket titles, identities, and discussion. Those scenes are labeled "Illustrative ticket data".
- The plugin segment demonstrates the current New plugin prompt and the Plugin Guide. It does not claim that the example plugin has been installed or published.
- English narration was generated locally with the macOS Samantha voice. No music or external stock assets.
- No live ticket data, personal browser chrome, credentials, or private filesystem paths are present in the distributed video or share bundle.

## Validation

- Full video decode completed without errors.
- 1920 × 1080, 24 fps, H.264 video, AAC audio, fast-start MP4.
- Captions were timed to each spoken phrase, with SRT and WebVTT sidecars.
- Checked representative rendered frames across the walkthrough, including both reconstructed GUS scenes.

The production scripts and sanitized stills are retained in this folder for edits. Original captures with personal browser chrome or live ticket content were removed after sanitization.
'''
(P/'README.md').write_text(readme)
files=['Zana-demo.mp4','thumbnail.jpg','captions.srt','captions.vtt','narration.md','chapters.json','watch.html','README.md']
with zipfile.ZipFile(P/'Zana-demo-share.zip','w',zipfile.ZIP_DEFLATED) as z:
 for name in files:z.write(P/name,'Zana-demo/'+name)
print('Packaged',[(name,(P/name).stat().st_size) for name in ['Zana-demo.mp4','Zana-demo-share.zip']],flush=True)
