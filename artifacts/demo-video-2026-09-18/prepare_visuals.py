from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
P=Path(__file__).parent
OUT=P/'stills'; OUT.mkdir(exist_ok=True)
REG='/System/Library/Fonts/SFNS.ttf'
def font(n): return ImageFont.truetype(REG,n)
def text(d,xy,s,n=14,fill='#293142'): d.text(xy,s,font=font(n),fill=fill)
def rr(d,box,fill='#f5f6f9',outline='#d9dde5',r=8): d.rounded_rectangle(box,r,fill=fill,outline=outline)
for p in (P/'raw').glob('*.png'):
 if 'private' in p.name: continue
 im=Image.open(p).convert('RGB').crop((0,92,1314,768))
 d=ImageDraw.Draw(im)
 d.rectangle((1254,0,1314,28),fill='#f7f8fa')
 im.save(OUT/p.name)
# Keep the real application shell and replace the entire GUS data region.
im=Image.open(P/'raw/07-gus-board-private.png').convert('RGB')
d=ImageDraw.Draw(im)
d.rectangle((228,120,1313,767),fill='#f7f8fa')
d.rectangle((0,92,1313,119),fill='#f7f8fa'); text(d,(642,101),'Zana',10)
text(d,(243,128),'GUS',16); text(d,(290,131),'demo@example.com',11, '#7a8290')
rr(d,(714,125,817,145)); rr(d,(717,127,768,143),'#e6e9ef',None,5); text(d,(724,130),'My work',10); text(d,(773,130),'Backlog',10)
text(d,(1168,131),'3 items',10,'#727b89'); text(d,(1237,127),'↻',18)
d.line((228,151,1314,151),fill='#e1e4eb')
d.rectangle((228,152,418,767),fill='#ffffff');d.line((418,152,418,767),fill='#e1e4eb')
rr(d,(237,160,409,182));text(d,(248,165),'Filter work…',11,'#8a929f')
text(d,(242,198),'WATCHING',10,'#8a929f');text(d,(396,196),'+',13,'#8a929f')
text(d,(242,220),'Follow a sprint, team, or ticket',10,'#7b8491')
d.line((238,238,407,238),fill='#e1e4eb');text(d,(242,251),'SPRINT',10,'#8a929f')
text(d,(242,274),'All sprints',11)
rr(d,(237,294,409,333),'#e8ecf5',None,5);text(d,(255,300),'Current sprint',12);text(d,(255,316),'14 Sep – 27 Sep 2026',10,'#7a8290')
rr(d,(237,341,409,363));text(d,(250,347),'Demo team',11,'#697485')
text(d,(242,387),'September sprint',11);text(d,(242,404),'14 Sep – 27 Sep 2026',10,'#8a929f')
text(d,(242,442),'Previous sprint',11);text(d,(242,460),'31 Aug – 13 Sep 2026',10,'#8a929f')
text(d,(244,737),'□  Show closed',11,'#727b89')
rr(d,(430,161,504,183));text(d,(442,166),'Everyone',11)
rr(d,(512,161,566,183),'#0874dc',None);text(d,(524,166),'Me 3',11,'#fff')
rr(d,(576,161,649,183));text(d,(588,166),'Alex 2',11)
rr(d,(660,161,734,183));text(d,(672,166),'Sam 1',11)
cols=[('NEW','W-100001','Add task filters','3 pts'),('IN PROGRESS','W-100002','Improve keyboard navigation','2 pts'),('READY FOR REVIEW','W-100003','Review dashboard layout','5 pts'),('FIXED',None,None,None)]
for i,(label,key,title,pts) in enumerate(cols):
 x=429+i*216
 rr(d,(x,204,x+204,755),'#fff','#dce0e7')
 rr(d,(x+1,205,x+203,233),'#f1f3f7',None,6)
 text(d,(x+10,214),label,10); text(d,(x+184,214),'1' if key else '0',10,'#8a929f')
 if not key:
  text(d,(x+62,257),'Nothing here',11,'#abb1bb'); continue
 rr(d,(x+8,245,x+196,359),'#f1f3f7','#c6ccd6',6)
 text(d,(x+19,255),key,11,'#2677c8')
 lines={'Add task filters':['Add task filters'],'Improve keyboard navigation':['Improve keyboard','navigation'],'Review dashboard layout':['Review dashboard','layout']}[title]
 for j,line in enumerate(lines):text(d,(x+19,277+j*15),line,12)
 rr(d,(x+18,314,x+176,330),'#f9fafc','#e2e5ec',4);text(d,(x+23,317),'September sprint',9,'#748092')
 text(d,(x+20,340),pts+'  ·  Demo user',10,'#748092')
im=im.crop((0,92,1314,768)); im.save(OUT/'07-gus-board.png')
# Use the real ticket-detail toolbar, on top of the clean demo board.
bg=im.convert('RGBA'); shade=Image.new('RGBA',bg.size,(18,24,38,110)); bg=Image.alpha_composite(bg,shade).convert('RGB');d=ImageDraw.Draw(bg)
rr(d,(383,82,931,650),'#fff','#d6dae3',10)
source=Image.open(P/'raw/08-gus-detail-private.png').convert('RGB')
bg.paste(source.crop((383,174,931,211)),(383,82));d=ImageDraw.Draw(bg)
d.rectangle((395,87,614,114),fill='#f2f3f7');text(d,(408,96),'W-100003',11,'#2479c5')
text(d,(398,132),'Review dashboard layout',17)
rr(d,(398,165,916,306),'#f7f8fa','#e0e4eb',6)
for x,y,label,val in [(410,176,'STATUS','Ready for Review'),(580,176,'TYPE','User Story'),(750,176,'POINTS','5'),(410,218,'SPRINT','September sprint'),(580,218,'TEAM','Demo team'),(750,218,'PRODUCT','Task dashboard'),(410,261,'ASSIGNEE','Demo user'),(580,261,'QA','Demo reviewer'),(750,261,'MODIFIED','18 Sep 2026')]:
 text(d,(x,y),label,9,'#9099a7');text(d,(x,y+13),val,11)
text(d,(399,326),'DETAILS',10,'#9199a6')
text(d,(406,350),'Review the task dashboard before the next milestone.',12)
text(d,(406,374),'• Check status grouping and owner filters.',12)
text(d,(406,397),'• Confirm clear keyboard focus states.',12)
text(d,(399,445),'CHATTER   2',10,'#9199a6')
for y,name,comment in [(474,'Demo user','Layout update is ready for review.'),(537,'Demo reviewer','I will check the keyboard flow and empty states.')]:
 d.ellipse((399,y,420,y+21),fill='#e7ebf2');text(d,(403,y+5),'D',10,'#738094')
 text(d,(431,y),name,12);text(d,(431,y+21),comment,11,'#637085')
bg.save(OUT/'08-gus-detail.png')
# Contact sheet of sanitized footage only.
ps=list(OUT.glob('*.png')); w=480;h=280
sheet=Image.new('RGB',(w*3,h*((len(ps)+2)//3)),'#111827');sd=ImageDraw.Draw(sheet)
for i,p in enumerate(sorted(ps)):
 a=Image.open(p);a.thumbnail((w-20,h-35));x=(i%3)*w+10;y=(i//3)*h+25
 sheet.paste(a,(x,y));text(sd,(x,y-20),p.name,14,'#ffffff')
sheet.save(P/'contact-sheet.png')
