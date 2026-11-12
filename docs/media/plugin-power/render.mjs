// Renders plugin-power.html into the Help video
// "Zana is built from plugins. Including yours."
//
//   node docs/media/plugin-power/render.mjs [--light] [--stills]
//
// Same deterministic frame capture as guided-start/render.mjs: the page timeline is
// seeked to each frame time and every CSS animation is advanced by the same clock.
// Outputs land in this folder's out/ (gitignored scratch); copy to content/videos/.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'out');
const FPS = 30;
const INTRO = 3.5; // mirrors INTRO in plugin-power.html
const DURATION = 30 + INTRO;
const WIDTH = 1920;
const HEIGHT = 1080;
const STAGE_W = 1120;
const POSTER_AT = 21.2 + INTRO;
const stillsOnly = process.argv.includes('--stills');
const light = process.argv.includes('--light');
const NAME = light ? 'plugin-power-light' : 'plugin-power';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 760 }, deviceScaleFactor: WIDTH / STAGE_W });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(pathToFileURL(join(here, 'plugin-power.html')).href + (light ? '?theme=light' : ''));
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
const step = (t) => page.evaluate(([v, dt]) => window.__frame(v, dt), [t, 1000 / FPS]);
const tmp = mkdtempSync(join(tmpdir(), 'plugin-power-'));
mkdirSync(outDir, { recursive: true });
try {
  if (stillsOnly) {
    const stills = [0, 1.3, 1.9, 2.8, 3.2, 5.7].map((t) => Math.round(t * FPS));
    for (let i = 0; i <= stills.at(-1); i++) {
      await step(i / FPS);
      if (stills.includes(i)) await stage.screenshot({ path: join(tmp, `still-${(i / FPS).toFixed(1)}.png`), animations: 'allow' });
    }
    console.log(`stills in ${tmp}`);
  } else {
    const frames = FPS * DURATION;
    for (let i = 0; i < frames; i++) {
      const t = i / FPS;
      await step(t);
      await stage.screenshot({ path: join(tmp, `f${String(i).padStart(4, '0')}.png`), animations: 'allow' });
      if (Math.abs(t - POSTER_AT) < 0.5 / FPS) await stage.screenshot({ path: join(tmp, 'poster.jpg'), type: 'jpeg', quality: 90 });
      if (i % 150 === 0) console.log(`frame ${i}/${frames}`);
    }
    execFileSync('ffmpeg', [
      '-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(tmp, 'f%04d.png'),
      '-vf', `scale=${WIDTH}:${HEIGHT}:flags=lanczos`, '-c:v', 'libx264', '-preset', 'slow',
      '-tune', 'animation', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
      join(outDir, `${NAME}.mp4`)
    ]);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(tmp, 'poster.jpg'),
      '-vf', `scale=${WIDTH}:${HEIGHT}:flags=lanczos`, '-q:v', '4', join(outDir, `${NAME}.jpg`)]);
    writeFileSync(join(outDir, `${NAME}.en.vtt`), captions());
    console.log(`wrote ${outDir}`);
  }
} finally {
  await browser.close();
  if (!stillsOnly) rmSync(tmp, { recursive: true, force: true });
}
if (errors.length) { console.error(errors); process.exit(1); }

// Mirrors CAPS in plugin-power.html; update both together.
function captions() {
  const cues = [
    [0, 2.7, 'Almost everything in Zana is a plugin — agents, panels and tools'],
    [2.7, 4.8, 'Take the plugins away — and only the core is left'],
    [4.8, 7.0, 'So whatever is missing, you can add — a plugin is just code'],
    [7.0, 13.0, 'Describe the plugin you want — the agent writes it, Zana loads it'],
    [13.0, 16.5, 'It’s live in your sidebar — no restart'],
    [16.5, 23.5, 'Change it while you use it — Zana reloads the panel in place'],
    [23.5, 25.4, 'Share it in one prompt — it lands in your team’s plugins'],
    [25.4, 27.6, 'Your teammates install it in one click — same plugin, their Zana'],
    [27.6, 30, 'Zana, shaped by you — build the plugin you need']
  ];
  const shifted = [[0, INTRO, 'Zana — built from plugins. Including yours.'], ...cues.map(([a, b, x]) => [a + INTRO, b + INTRO, x])];
  const ts = (s) => `00:00:${s.toFixed(3).padStart(6, '0')}`;
  return `WEBVTT\n\n${shifted.map(([a, b, text], i) => `${i + 1}\n${ts(a)} --> ${ts(b)}\n${text}\n`).join('\n')}`;
}
