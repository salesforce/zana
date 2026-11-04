// Capture intro.html frame by frame. usage:
//   node intro.cjs video <out.mp4> <app-frame.jpg> <vo-seconds,...>
//   node intro.cjs stills <dir> <app-frame.jpg> <vo-seconds,...> <t> [t...]
const { chromium } = require('@playwright/test');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const [mode, out, app, vo, ...times] = process.argv.slice(2);
const FPS = 30;

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const url = new URL('file://' + path.join(__dirname, 'intro.html'));
    url.searchParams.set('app', 'file://' + path.resolve(app));
    url.searchParams.set('vo', vo);
    await page.goto(url.href);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => [...document.images].every((img) => img.complete));
    const duration = await page.evaluate(() => window.TIMING.DURATION);
    const shot = async (t) => { await page.evaluate((x) => window.render(x), t); return page.screenshot({ type: 'png' }); };
    if (mode === 'stills') {
      fs.mkdirSync(out, { recursive: true });
      for (const t of times) fs.writeFileSync(path.join(out, `intro-${t}.png`), await shot(Number(t)));
      return;
    }
    const ffmpeg = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'png', '-r', String(FPS), '-i', '-',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', out], { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise((resolve, reject) => ffmpeg.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)))));
    for (let i = 0; i < Math.round(duration * FPS); i++) {
      if (!ffmpeg.stdin.write(await shot(i / FPS))) await new Promise((resolve) => ffmpeg.stdin.once('drain', resolve));
    }
    ffmpeg.stdin.end();
    await done;
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
