// Capture card.html (opener or closer) frame by frame. usage:
//   node card.cjs video <out.mp4> --config <video.json> --mode opener|closer --app <frame.jpg> [--vo s,s] [--fps 30]
//   node card.cjs stills <dir>    --config <video.json> --mode opener|closer --app <frame.jpg> [--vo s,s] --at t [--at t ...]
const { chromium } = require('@playwright/test');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function parse(argv) {
  const [mode, out, ...rest] = argv;
  const opts = { at: [], fps: 30, vo: '' };
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i].replace(/^--/, ''), value = rest[i + 1];
    if (value === undefined) throw new Error(`missing value for ${rest[i]}`);
    if (key === 'at') opts.at.push(Number(value)); else opts[key] = key === 'fps' ? Number(value) : value;
  }
  if (!['video', 'stills'].includes(mode) || !out || !opts.config || !opts.app) throw new Error('usage: node card.cjs video|stills <out> --config <video.json> --mode opener|closer --app <frame.jpg> [--vo s,s] [--fps 30] [--at t]');
  if (!['opener', 'closer'].includes(opts.mode)) throw new Error('--mode must be opener or closer');
  return { mode, out, opts };
}

(async () => {
  const { mode, out, opts } = parse(process.argv.slice(2));
  const cfg = JSON.parse(fs.readFileSync(opts.config, 'utf8'));
  if (opts.mode === 'closer' && !cfg.closer) throw new Error('video.json has no closer');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: cfg.width, height: cfg.height }, deviceScaleFactor: 1 });
    const url = new URL('file://' + path.join(__dirname, 'card.html'));
    url.searchParams.set('cfg', JSON.stringify(cfg));
    url.searchParams.set('mode', opts.mode);
    url.searchParams.set('app', 'file://' + path.resolve(opts.app));
    url.searchParams.set('vo', opts.vo);
    await page.goto(url.href);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => [...document.images].every((img) => img.complete));
    const duration = await page.evaluate(() => window.TIMING.DURATION);
    const shot = async (t) => { await page.evaluate((x) => window.render(x), t); return page.screenshot({ type: 'png' }); };
    if (mode === 'stills') {
      fs.mkdirSync(out, { recursive: true });
      for (const t of opts.at) fs.writeFileSync(path.join(out, `${opts.mode}-${t}.png`), await shot(t));
      return;
    }
    const ffmpeg = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'png', '-r', String(opts.fps), '-i', '-',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', out], { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise((resolve, reject) => ffmpeg.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)))));
    for (let i = 0; i < Math.round(duration * opts.fps); i++) {
      if (!ffmpeg.stdin.write(await shot(i / opts.fps))) await new Promise((resolve) => ffmpeg.stdin.once('drain', resolve));
    }
    ffmpeg.stdin.end();
    await done;
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
