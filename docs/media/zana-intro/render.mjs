// Captures intro.html frame by frame into an intro clip, sized for a target video.
//
//   node docs/media/zana-intro/render.mjs --out intro.mp4 [--width 1920 --height 1080 --fps 30]
//        [--theme light|dark] [--tagline "…"] [--accent "…"] [--bg first-frame.png] [--poster poster.jpg]
//
// Usually called by prepend.py. The stage is 1120 CSS px wide and keeps the target aspect ratio.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const out = resolve(arg('out', join(here, 'clips', 'intro.mp4')));
const WIDTH = +arg('width', 1920), HEIGHT = +arg('height', 1080), FPS = +arg('fps', 30);
const STAGE_W = 1120, STAGE_H = Math.round(STAGE_W * HEIGHT / WIDTH);
const params = new URLSearchParams({ w: STAGE_W, h: STAGE_H, theme: arg('theme', 'dark'), tagline: arg('tagline', 'Built from plugins.'), accent: arg('accent', 'Including yours.') });
if (arg('bg')) params.set('bg', pathToFileURL(resolve(arg('bg'))).href);
const poster = arg('poster');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: STAGE_W + 40, height: STAGE_H + 40 }, deviceScaleFactor: WIDTH / STAGE_W });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(pathToFileURL(join(here, 'intro.html')).href + '?' + params);
await page.waitForFunction(() => [...document.images].every((i) => i.complete));
const { DURATION, POSTER_AT } = await page.evaluate(() => ({ DURATION: ZanaIntro.DURATION, POSTER_AT: ZanaIntro.POSTER_AT }));
const stage = page.locator('#stage');
const tmp = mkdtempSync(join(tmpdir(), 'zana-intro-'));
try {
  const frames = Math.round(DURATION * FPS);
  for (let i = 0; i < frames; i++) {
    await page.evaluate((t) => window.render(t), i / FPS);
    await stage.screenshot({ path: join(tmp, `f${String(i).padStart(4, '0')}.png`) });
    if (poster && i === Math.round(POSTER_AT * FPS)) await stage.screenshot({ path: join(tmp, 'poster.png') });
  }
  if (errors.length) throw new Error(errors.join('\n'));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(tmp, 'f%04d.png'),
    '-vf', `scale=${WIDTH}:${HEIGHT}:flags=lanczos,setsar=1`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '16',
    '-pix_fmt', 'yuv420p', '-r', String(FPS), out]);
  if (poster) execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(tmp, 'poster.png'), '-vf', `scale=${WIDTH}:${HEIGHT}:flags=lanczos`, '-q:v', '3', resolve(poster)]);
  console.log(`intro ${WIDTH}x${HEIGHT}@${FPS} ${DURATION}s -> ${out}`);
} finally {
  await browser.close();
  rmSync(tmp, { recursive: true, force: true });
}
