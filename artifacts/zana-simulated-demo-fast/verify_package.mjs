import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const temp=await mkdtemp(path.join(os.tmpdir(),'zana-demo-package-'));
let browser;
try {
  execFileSync('unzip',['-q',path.join(root,'Zana-demo-fast-share.zip'),'-d',temp]);
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url());});
  await page.goto(pathToFileURL(path.join(temp,'Zana-demo/watch.html')).href);
  await page.waitForFunction(()=>document.querySelector('video').readyState>=1);
  assert.equal(await page.locator('video').evaluate(v=>v.duration),130);
  await page.locator('[data-time="77.5"]').click();
  await page.waitForFunction(()=>document.querySelector('video').currentTime>=77.5);
  await page.locator('video').evaluate(v=>v.pause());
  await page.locator('#interactive').click();
  await page.waitForFunction(()=>Boolean(window.demo));
  await page.locator('#explore').click();
  await page.locator('[data-toggle="1"]').click();
  assert.equal(await page.locator('[data-count]').innerText(),'1 of 3 complete');
  await page.locator('#new-task').fill('Share this demo');
  await page.locator('#new-task').press('Enter');
  assert.equal(await page.locator('[data-count]').innerText(),'1 of 4 complete');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  const report={ok:true,offline:true,videoDuration:130,chapterSeek:77.5,interactivePlugin:true,pageErrors:errors,externalRequests:external.length};
  await writeFile(path.join(root,'render/package-verification.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally {
  if(browser)await browser.close();
  await rm(temp,{recursive:true,force:true});
}
