import json, math, subprocess, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter
P=Path(__file__).parent
W,H=1920,1080; FPS=24
F='/System/Library/Fonts/SFNS.ttf'
FB='/System/Library/Fonts/SFNS.ttf'
FONT={}
def font(size):
 if size not in FONT:FONT[size]=ImageFont.truetype(F,size)
 return FONT[size]
def txt(d,xy,s,size=26,fill='#e9eef9',anchor=None):d.text(xy,s,font=font(size),fill=fill,anchor=anchor)
def wrap(s,max_width,size):
 lines=[];line=''
 for word in s.split():
  test=(line+' '+word).strip()
  if font(size).getlength(test)>max_width and line: lines.append(line);line=word
  else:line=test
 if line:lines.append(line)
 return lines
# Static branded canvas. The app footage is framed, never drawn over by captions.
bg=Image.new('RGB',(W,H));px=bg.load()
for y in range(H):
 for x in range(W):
  g=max(0,1-math.hypot((x-1450)/1500,(y-50)/1100))
  px[x,y]=(int(10+9*g),int(17+15*g),int(32+21*g))
logo=Image.open('/Users/grebmann/zcc-workspace/zana-command-center/resources/icon-1024.png').convert('RGBA');logo.thumbnail((46,46))
chapters=['Project','Agent','Monitor','GUS','Plugins']
def common(scene):
 im=bg.copy();d=ImageDraw.Draw(im)
 im.paste(logo,(96,32),logo);txt(d,(156,44),'ZANA',24)
 txt(d,(255,46),'PRODUCT WALKTHROUGH',15,'#96a7c3')
 for j,s in enumerate(chapters):
  x=945+j*171;active=scene['chapter']==j+1;past=scene['chapter']>j+1
  color='#73e3cd' if active else '#9aaac3' if past else '#64748e'
  d.ellipse((x,41,x+23,64),fill='#183d43' if active else '#243047')
  txt(d,(x+12,53),str(j+1),12,color,anchor='mm');txt(d,(x+32,44),s,18,color)
 txt(d,(96,105),scene['title'],44)
 if scene.get('sample'):
  txt(d,(1820,137),'ILLUSTRATIVE TICKET DATA',15,'#82dacb',anchor='rs')
 return im

def caption_layer(s):
 a=Image.new('RGBA',(W,H));d=ImageDraw.Draw(a)
 lines=wrap(s,1580,33)
 sy=975 if len(lines)==1 else 955
 for k,line in enumerate(lines):txt(d,(W/2,sy+k*43),line,33,'#f5f8ff',anchor='mt')
 return a

def hero(scene,t):
 im=bg.copy();d=ImageDraw.Draw(im)
 # A restrained animated arc behind the hero.
 for k in range(3):
  off=k*120;r=510+off
  d.arc((1220-r,345-r,1220+r,345+r),start=205,end=330,fill=(20+4*k,47+3*k,67+3*k),width=2)
 im.paste(logo,(100,65),logo);txt(d,(166,77),'ZANA',27)
 txt(d,(103,215),'YOUR AI WORK, ORGANIZED',20,'#79e2ce')
 lines= ['Your work.','One command center.'] if scene['id']=='intro' else ['Start a project.','Give it a goal.']
 for i,line in enumerate(lines):txt(d,(98,291+i*107),line,88)
 txt(d,(105,548),scene['subtitle'],34,'#abbdd7')
 labels=['01  Project','02  Agent','03  Monitor','04  GUS','05  Plugins']
 for i,label in enumerate(labels):
  x=105+i*343
  d.rounded_rectangle((x,687,x+310,770),18,fill='#17283f',outline='#2d435f',width=2)
  txt(d,(x+24,714),label,24,'#dce8fa')
 txt(d,(105,828),'A guided walkthrough with a fictional demo project',20,'#8094b3')
 return im

scenes=json.loads((P/'timeline.json').read_text()); clips=P/'clips';clips.mkdir(exist_ok=True)
start=0;srt=[];vtt=['WEBVTT\n'];script=['# Zana walkthrough narration\n'];chaptersout=[]
def stamp(t,sep=','):
 ms=round(t*1000); hh,ms=divmod(ms,3600000);mm,ms=divmod(ms,60000);ss,ms=divmod(ms,1000)
 return f'{hh:02}:{mm:02}:{ss:02}{sep}{ms:03}'
for idx,scene in enumerate(scenes):
 scene['start']=start;chaptersout.append({'at':round(start,3),'title':scene['title']})
 script.append(f"## {stamp(start,'.')[:-4]} — {scene['title']}\n\n"+' '.join(scene['lines'])+'\n')
 for cap in scene['captions']:
  srt.extend([str(len(srt)//4+1),f"{stamp(start+cap['start'])} --> {stamp(start+cap['end'])}",cap['text'],''])
  vtt.extend([f"{stamp(start+cap['start'],'.')} --> {stamp(start+cap['end'],'.')}",cap['text'],''])
 start+=scene['duration']
 dest=clips/f'{idx:02d}-{scene["id"]}.mp4'
 if dest.exists() and '--force' not in sys.argv:
  print('Reuse',dest.name,flush=True);continue
 base=common(scene);tile=(96,177,1824,915);tw=1728;th=738
 if scene.get('shot'):
  shot=Image.open(P/'stills'/scene['shot']).convert('RGB')
  crop=scene.get('crop',[0,0,*shot.size]); shot=shot.crop(crop)
  scale=min(tw/shot.width,th/shot.height)
  sw,sh=int(shot.width*scale),int(shot.height*scale)
  sx=96+(tw-sw)//2;sy=177+(th-sh)//2
  mask=Image.new('L',(sw,sh));ImageDraw.Draw(mask).rounded_rectangle((0,0,sw-1,sh-1),14,fill=255)
  # Draw a shadow around the footage panel.
  shadow=Image.new('RGBA',(W,H));sd=ImageDraw.Draw(shadow)
  sd.rounded_rectangle((sx-2,sy+8,sx+sw+2,sy+sh+13),17,fill=(0,0,0,135));shadow=shadow.filter(ImageFilter.GaussianBlur(15));base=Image.alpha_composite(base.convert('RGBA'),shadow).convert('RGB')
  full=ImageDraw.Draw(base);full.rounded_rectangle((sx-2,sy-2,sx+sw+2,sy+sh+2),16,outline='#40536c',width=2)
 caplayers=[caption_layer(c['text']) for c in scene['captions']]
 cmd=['ffmpeg','-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','pipe:0','-i',str(P/'audio'/f"{scene['id']}.wav"),'-c:v','libx264','-preset','fast','-crf','19','-threads','4','-pix_fmt','yuv420p','-c:a','aac','-b:a','160k','-t',str(scene['duration']),'-movflags','+faststart',str(dest)]
 proc=subprocess.Popen(cmd,stdin=subprocess.PIPE)
 for n in range(scene['frames']):
  t=n/FPS;progress=n/max(1,scene['frames']-1)
  if scene.get('shot'):
   im=base.copy()
   # Slow push-in: two percent over the shot; the complete control stays in view.
   z=1+.025*(.5-.5*math.cos(math.pi*progress))
   cw=shot.width/z;ch=shot.height/z
   moving=shot.resize((sw,sh),Image.Resampling.BICUBIC,box=((shot.width-cw)/2,(shot.height-ch)/2,(shot.width+cw)/2,(shot.height+ch)/2))
   fade=min(1,t/.28,(scene['duration']-t)/.24)
   if fade<1:moving=Image.blend(Image.new('RGB',(sw,sh),'#122137'),moving,max(0,fade))
   im.paste(moving,(sx,sy),mask)
   if scene.get('focus') and 1.4<t<4.4:
    fx,fy=scene['focus']; fx=((fx-crop[0])-shot.width/2)*z*scale+sw/2+sx;fy=((fy-crop[1])-shot.height/2)*z*scale+sh/2+sy
    if sx+5<fx<sx+sw-5 and sy+5<fy<sy+sh-5:
     glow=Image.new('RGBA',(W,H));gd=ImageDraw.Draw(glow);rad=22+7*math.sin((t-1.4)*3);alpha=int(150*min(1,(t-1.4)/.3,(4.4-t)/.4))
     gd.ellipse((fx-rad,fy-rad,fx+rad,fy+rad),outline=(25,168,148,alpha),width=4);im=Image.alpha_composite(im.convert('RGBA'),glow).convert('RGB')
  else:im=hero(scene,t)
  for k,c in enumerate(scene['captions']):
   if c['start']<=t<c['end']+.15:im=Image.alpha_composite(im.convert('RGBA'),caplayers[k]).convert('RGB');break
  d=ImageDraw.Draw(im);x=96+int(1728*((scene['start']+t)/sum(s['duration'] for s in scenes)))
  d.rectangle((96,1058,1824,1060),fill='#24344c');d.rectangle((96,1058,x,1060),fill='#72decb')
  if n==min(scene['frames']-1,int(scene['duration']*.45)*FPS):im.save(P/'frames'/f'{idx:02d}-{scene["id"]}.png')
  proc.stdin.write(im.tobytes())
 proc.stdin.close();code=proc.wait()
 if code:raise SystemExit(f'encode failed: {code}')
 print('Rendered',idx,scene['id'],scene['duration'],flush=True)
(P/'captions.srt').write_text('\n'.join(srt));(P/'captions.vtt').write_text('\n'.join(vtt));(P/'narration.md').write_text('\n'.join(script));(P/'chapters.json').write_text(json.dumps(chaptersout,indent=2));(P/'timeline.json').write_text(json.dumps(scenes,indent=2))
paths=sorted(clips.glob('*.mp4'));(P/'concat.txt').write_text(''.join("file '"+str(p.resolve())+"'\n" for p in paths))
subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',str(P/'concat.txt'),'-c:v','copy','-af','loudnorm=I=-16:TP=-1.5:LRA=11','-c:a','aac','-b:a','160k','-movflags','+faststart',str(P/'Zana-demo.mp4')],check=True)
print('FINISHED',round(start,2),'seconds',flush=True)
