/* Capture only this local fake app, in a new headless Chromium process. */
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
const fps=24, duration=190;
const start=Number(process.env.DEMO_START||0), end=Number(process.env.DEMO_END||duration);
const full=start===0&&end===duration;
if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>duration||end<=start)throw Error('Invalid render range');
await mkdir(path.join(root,'render'),{recursive:true});
let browser,encoder;
const started=Date.now();
try{
  browser=await chromium.launch({headless:true,args:['--disable-background-timer-throttling']});
  const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.join(root,'index.html')).href+'?capture=1');
  await page.evaluate(()=>document.fonts.ready);
  const cdp=await page.context().newCDPSession(page);
  const silent=path.join(root,'render',full?'silent.mp4':'sample-silent.mp4');
  encoder=spawn('ffmpeg',['-hide_banner','-loglevel','warning','-y','-f','image2pipe','-framerate',String(fps),'-vcodec','mjpeg','-i','pipe:0','-an','-vf','scale=in_range=full:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p','-c:v','libx264','-preset','medium','-crf','17','-pix_fmt','yuv420p','-color_range','tv','-colorspace','bt709','-color_trc','bt709','-color_primaries','bt709','-movflags','+faststart',silent],{stdio:['pipe','ignore','pipe']});
  let stderr='';encoder.stderr.on('data',data=>{stderr=(stderr+data.toString()).slice(-5000);});
  const closed=once(encoder,'close');
  const frames=Math.round((end-start)*fps);
  for(let i=0;i<frames;i++){
    await page.evaluate(t=>demo.seek(t),start+i/fps);
    const shot=await cdp.send('Page.captureScreenshot',{format:'jpeg',quality:96,fromSurface:true,captureBeyondViewport:false,optimizeForSpeed:true});
    if(!encoder.stdin.write(Buffer.from(shot.data,'base64')))await once(encoder.stdin,'drain');
    if(i%240===0)console.log(`Rendered ${(i/fps+start).toFixed(0)} / ${end}s · ${((Date.now()-started)/1000).toFixed(0)}s elapsed`);
  }
  encoder.stdin.end();
  const [code]=await closed;
  if(code!==0)throw Error(`Encoder exited ${code}: ${stderr}`);
  if(errors.length)throw Error(errors.join('\n'));
  const chapters=await page.evaluate(()=>DemoTimeline.chapters);
  const metadata=';FFMETADATA1\ntitle=Zana — a simulated product walkthrough\nartist=Zana\ncomment=Fictional projects, agents, tickets and plugin actions. Rendered from a scripted replica.\n'+chapters.map((c,i)=>`[CHAPTER]\nTIMEBASE=1/1000\nSTART=${c.at*1000}\nEND=${(chapters[i+1]?.at||duration)*1000}\ntitle=${c.label}\n`).join('');
  await writeFile(path.join(root,'render/chapters.ffmeta'),metadata);
  const output=path.join(root,full?'Zana-simulated-demo.mp4':'render/sample.mp4');
  const args=full?['-i',silent,'-i',path.join(root,'audio/narration.m4a'),'-i',path.join(root,'render/chapters.ffmeta'),'-map','0:v','-map','1:a','-map_metadata','2','-map_chapters','2','-c','copy','-movflags','+faststart',output]:['-i',silent,'-ss',String(start),'-t',String(end-start),'-i',path.join(root,'audio/narration.m4a'),'-map','0:v','-map','1:a','-c','copy','-shortest','-movflags','+faststart',output];
  const mux=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y',...args],{stdio:'inherit'});
  const [muxCode]=await once(mux,'close');if(muxCode!==0)throw Error('Audio mux failed');
  const report={file:path.basename(output),duration:end-start,fps,frames,width:1920,height:1080,headless:true,secondsElapsed:+((Date.now()-started)/1000).toFixed(1),pageErrors:errors};
  await writeFile(path.join(root,'render',full?'render-report.json':'sample-report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}finally{
  if(encoder && encoder.exitCode===null)encoder.kill('SIGTERM');
  if(browser)await browser.close();
}
