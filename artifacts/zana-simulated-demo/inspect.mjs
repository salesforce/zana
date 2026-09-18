import { chromium } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
await mkdir(path.join(root,'render'),{recursive:true});
const browser=await chromium.launch({headless:true});
try {
const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
const errors=[];
page.on('pageerror', e=>errors.push(e.message));
await page.goto(pathToFileURL(path.join(root,'index.html')).href+'?capture=1');
await page.evaluate(()=>document.fonts.ready);
const cues=[
  [8.5,'add-project'],[11,'add-local'],[12.1,'path'],[19.5,'confirm-project'],[23,'new-agent'],[25,'provider'],[27.3,'codex'],[29,'.draft'],[36,'send'],[46,'nav-bot'],[53,'agent-card'],[55,'answer'],[57.5,'continue'],[60.5,'diff'],[73,'preview-toolbar'],[79,'nav-bot'],[85,'nav-gus'],[89,'me'],[92,'sprint'],[94,'ticket'],[97,'watch'],[101,'chatter'],[107,'work-with-agent'],[113,'send'],[119,'nav-plugin'],[125,'new-plugin'],[125.8,'.draft'],[137,'send'],[154,'review-install'],[158.5,'install'],[161,'nav-focus'],[164.5,'focus-0'],[168,'focus-1'],[170,'focus-input'],[174,'focus-add'],
];
const points=[];
for (const [time,cue] of cues) {
  await page.evaluate(t=>demo.seek(t),time-.01);
  const locator=page.locator(cue.startsWith('.')?cue:`[data-cue="${cue}"]`).first();
  const box=await locator.boundingBox();
  if(!box)throw Error(`No cursor target ${time}: ${cue}`);
  // Checkboxes target their leading square; all other controls target their center.
  points.push({time,cue,x:Math.round(box.x+(cue.startsWith('focus-') && /^focus-\d/.test(cue)?30:box.width/2)),y:Math.round(box.y+box.height/2)});
}
await writeFile(path.join(root,'render/cursor-targets.json'),JSON.stringify(points,null,2));
if(process.argv.includes('--calibrate')) {
  const moves=await page.evaluate(()=>DemoTimeline.moves);
  const coordinateMap=new Map();
  for(const point of points){const old=moves.find(m=>m[0]===point.time);if(!old)throw Error('Missing '+point.time);coordinateMap.set(old.slice(1,3).join(','),[point.x,point.y]);}
  const corrected=moves.map(m=>[m[0],...(coordinateMap.get(m.slice(1,3).join(','))||m.slice(1,3)),...m.slice(3)]);
  const file=path.join(root,'timeline.js');
  const source=await readFile(file,'utf8');
  await writeFile(file,source.replace(/const moves = \[[\s\S]*?\n  \];/, 'const moves = '+JSON.stringify(corrected,null,2).split('\n').map((line,i)=>i?'  '+line:line).join('\n')+';'));
  await page.reload();
}
for(const t of [2,15,31,42,51,55.5,66,71,75,90,98,103,108,124,132,147,151,156,163,168.5,175,184]){
  await page.evaluate(t=>demo.seek(t),t);
  await page.screenshot({path:path.join(root,'render',`scene-${String(t).padStart(5,'0')}.jpg`),type:'jpeg',quality:90});
}
console.log(JSON.stringify({errors,targets:points},null,2));
} finally { await browser.close(); }
