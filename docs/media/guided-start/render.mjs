// Renders guided-start.html into the bundled first-run tour video.
//
//   node docs/media/guided-start/render.mjs [--stills]
//
// Frames are captured deterministically: the page timeline is seeked to each
// frame time and every CSS transition/animation is paused and advanced by the
// same virtual clock, so the output does not depend on capture speed.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, '../../../apps/app/src/assets/onboarding');
const FPS = 30;
const DURATION = 30;
const WIDTH = 1920;
const HEIGHT = 1080;
const STAGE_W = 1120;
const POSTER_AT = 27.5;
const stillsOnly = process.argv.includes('--stills');

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1200, height: 760 },
  deviceScaleFactor: WIDTH / STAGE_W
});
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(pathToFileURL(join(here, 'guided-start.html')).href);
// Flat frame: the app rounds the video itself.
await page.addStyleTag({ content: '.stage { border:0 !important; border-radius:0 !important; box-shadow:none !important; }' });
await page.evaluate(() => {
  const clock = new WeakMap();
  window.__frame = (t, dtMs) => {
    window.__seek(t);
    render(t);
    for (const a of document.getAnimations()) {
      const v = clock.has(a) ? clock.get(a) + dtMs : 0;
      clock.set(a, v);
      a.pause();
      a.currentTime = v;
    }
  };
});

const stage = page.locator('.stage');
const shot = async (t, path, type = 'png') => {
  await page.evaluate(([v, dt]) => window.__frame(v, dt), [t, 1000 / FPS]);
  await stage.screenshot({ path, type, ...(type === 'jpeg' ? { quality: 90 } : {}), animations: 'allow' });
};

const out = mkdtempSync(join(tmpdir(), 'guided-start-'));
try {
  if (stillsOnly) {
    // Step every frame so transitions reach the same state as in the video.
    const stills = [2, 4.8, 6.8, 8.5, 11.3, 15, 19.6, 21.5, 23.5, 25.4, 27, 29].map((t) => Math.round(t * FPS));
    for (let i = 0; i <= stills.at(-1); i++) {
      if (stills.includes(i)) await shot(i / FPS, join(out, `still-${i / FPS}.png`));
      else await page.evaluate(([v, dt]) => window.__frame(v, dt), [i / FPS, 1000 / FPS]);
    }
    console.log(`stills in ${out}`);
  } else {
    const frames = FPS * DURATION;
    for (let i = 0; i < frames; i++) {
      const t = i / FPS;
      await shot(t, join(out, `f${String(i).padStart(4, '0')}.png`));
      if (Math.abs(t - POSTER_AT) < 0.5 / FPS) {
        await stage.screenshot({ path: join(out, 'poster.jpg'), type: 'jpeg', quality: 85 });
      }
      if (i % 150 === 0) console.log(`frame ${i}/${frames}`);
    }
    const mp4 = join(assets, 'guided-start.mp4');
    execFileSync('ffmpeg', [
      '-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(out, 'f%04d.png'),
      '-vf', `scale=${WIDTH}:${HEIGHT}:flags=lanczos`, '-c:v', 'libx264', '-preset', 'slow',
      '-tune', 'animation', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', mp4
    ]);
    execFileSync('ffmpeg', [
      '-y', '-loglevel', 'error', '-i', join(out, 'poster.jpg'),
      '-vf', `scale=${WIDTH}:${HEIGHT}:flags=lanczos`, '-q:v', '4', join(assets, 'guided-start.jpg')
    ]);
    copyFileSync(join(assets, 'guided-start.jpg'), join(here, 'poster.jpg'));
    writeFileSync(join(assets, 'guided-start.en.vtt'), captions());
    console.log(`wrote ${mp4}`);
  }
} finally {
  await browser.close();
  if (!stillsOnly) rmSync(out, { recursive: true, force: true });
}
if (errors.length) {
  console.error(errors);
  process.exit(1);
}

// Mirrors the on-screen captions in guided-start.html.
function captions() {
  const cues = [
    [0, 4, 'Everything starts in a project — a project is just a folder'],
    [4, 9.6, 'Add your first project — pick any folder on your Mac'],
    [9.6, 13.4, 'Pick any agent you like — Claude Code, Codex, Cursor, Pi…'],
    [13.4, 20.6, 'Ask for a design first — agents write and read your design docs'],
    [20.6, 25.2, 'Then let it build — preview right in the side panel'],
    [25.2, 28, 'Zana tells you when it’s done — reports land in your Inbox'],
    [28, 30, 'Your turn — add a folder and ask an agent']
  ];
  const ts = (s) => `00:00:${s.toFixed(3).padStart(6, '0')}`;
  return `WEBVTT\n\n${cues.map(([a, b, text], i) => `${i + 1}\n${ts(a)} --> ${ts(b)}\n${text}\n`).join('\n')}`;
}
