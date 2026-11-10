/**
 * Shared helper for narrated demo recordings (Squad guide videos, modelled on
 * e2e/demo-squads.spec.ts). See docs/media/squad-guide-README.md.
 *
 *   const demo = await createDemoVideo(page);
 *   await demo.flash();                       // black flash: render.py trims the recording here
 *   await demo.section({ number: 1, title: 'Thread tabs', subtitle: '...', hint: '...' });
 *   await demo.say('open-board');             // by narration id, or demo.caption('text') by caption
 *   demo.writeTimeline();                     // honours ZCC_DEMO_TIMELINE
 *
 * Env: ZCC_DEMO_NARRATION (durations.json from `render.py --audio`), ZCC_DEMO_TIMELINE,
 * ZCC_E2E_RECORD_VIDEO, ZCC_E2E_RECORD_SIZE (see e2e/fixtures/app.ts).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { NarrationCursor, parseRecordSize, sectionNumber, type NarrationEntry, type SectionCard } from './demo-video-core.js';

export { parseRecordSize, type SectionCard } from './demo-video-core.js';

export function loadNarration(path = process.env.ZCC_DEMO_NARRATION): NarrationEntry[] {
  return path ? (JSON.parse(readFileSync(path, 'utf8')) as NarrationEntry[]) : [];
}

export interface DemoVideo {
  cursor: NarrationCursor;
  /** Show the caption of narration line `id`, after the previous line has been spoken. */
  say(id: string): Promise<void>;
  /** Show a caption that must match the next narration line's caption. */
  caption(text: string): Promise<void>;
  /** Replace the numbered section title bar. */
  section(card: SectionCard): Promise<void>;
  clearSection(): Promise<void>;
  /** Wait until the line just said has been spoken, so the next screen change lands after it. */
  settle(): Promise<void>;
  /** Black flash then start the timeline clock. */
  flash(ms?: number): Promise<void>;
  /** Wait out the last line, then write ZCC_DEMO_TIMELINE. */
  finish(): Promise<void>;
  writeTimeline(): void;
}

const FONT = '-apple-system,"SF Pro Display","Helvetica Neue",system-ui,sans-serif';

export async function createDemoVideo(page: Page, narration: NarrationEntry[] = loadNarration()): Promise<DemoVideo> {
  const cursor = new NarrationCursor(narration);
  const { width } = parseRecordSize(process.env.ZCC_E2E_RECORD_SIZE);
  // Scale type with the frame so 1920x1080 and the 1440x900 default look alike.
  const scale = width / 1440;

  const show = (text: string) => page.evaluate(({ value, font, k }) => {
    let node = document.getElementById('e2e-caption');
    if (!node) {
      node = Object.assign(document.createElement('div'), { id: 'e2e-caption' });
      document.body.appendChild(node);
    }
    node.style.cssText = `position:fixed;left:50%;bottom:${40 * k}px;transform:translateX(-50%);z-index:99999;padding:${11 * k}px ${22 * k}px;border-radius:${12 * k}px;background:rgba(17,24,39,.9);color:#fff;font:600 ${22 * k}px/1.35 ${font};box-shadow:0 6px 24px rgba(0,0,0,.3);pointer-events:none;max-width:78vw;text-align:center`;
    node.textContent = value;
  }, { value: text, font: FONT, k: scale });

  const speak = async (key: { id?: string; caption?: string }, text: string) => {
    const hold = cursor.holdMs();
    if (hold > 0) await page.waitForTimeout(hold);
    cursor.advance(key, text);
    await show(text);
  };

  const writeTimeline = () => {
    if (process.env.ZCC_DEMO_TIMELINE) writeFileSync(process.env.ZCC_DEMO_TIMELINE, JSON.stringify(cursor.timeline, null, 2));
  };

  return {
    cursor,
    async say(id) {
      const entry = narration.find((e) => e.id === id);
      if (narration.length && !entry) throw new Error(`no narration line with id "${id}"`);
      await speak({ id }, entry?.caption ?? id);
    },
    caption: (text) => speak({ caption: text }, text),
    section: (card) => page.evaluate(({ number, title, subtitle, hint, font, k }) => {
      document.getElementById('e2e-section')?.remove();
      const bar = Object.assign(document.createElement('div'), { id: 'e2e-section' });
      bar.style.cssText = `position:fixed;left:0;right:0;top:0;z-index:99998;height:${64 * k}px;display:flex;align-items:center;gap:${18 * k}px;padding:0 ${28 * k}px;background:rgba(255,255,255,.96);border-bottom:1px solid rgba(15,23,42,.12);box-shadow:0 4px 18px rgba(30,41,80,.12);font-family:${font};color:#111827;pointer-events:none`;
      const part = (css: string, text: string) => {
        const el = document.createElement('div');
        el.style.cssText = css;
        el.textContent = text;
        bar.appendChild(el);
      };
      part(`font-weight:800;font-size:${26 * k}px;color:#2563eb;letter-spacing:-0.02em`, number);
      part(`font-weight:800;font-size:${26 * k}px;letter-spacing:-0.02em;white-space:nowrap`, title);
      part(`font-weight:500;font-size:${17 * k}px;color:#5b6475;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`, subtitle);
      if (hint) part(`font-weight:600;font-size:${15 * k}px;color:#374151;background:#eef2f9;border-radius:999px;padding:${6 * k}px ${14 * k}px;white-space:nowrap`, hint);
      document.body.appendChild(bar);
    }, { number: sectionNumber(card.number), title: card.title, subtitle: card.subtitle ?? '', hint: card.hint ?? '', font: FONT, k: scale }),
    clearSection: () => page.evaluate(() => document.getElementById('e2e-section')?.remove()),
    async flash(ms = 600) {
      await page.evaluate(() => {
        const node = Object.assign(document.createElement('div'), { id: 'e2e-flash' });
        node.style.cssText = 'position:fixed;inset:0;background:#000;z-index:100002';
        document.body.appendChild(node);
      });
      await page.waitForTimeout(ms);
      await page.evaluate(() => document.getElementById('e2e-flash')?.remove());
      cursor.start();
    },
    async settle() {
      const hold = cursor.holdMs();
      if (hold > 0) await page.waitForTimeout(hold);
    },
    async finish() {
      const hold = cursor.holdMs();
      if (hold > 0) await page.waitForTimeout(hold);
      cursor.assertComplete();
      writeTimeline();
    },
    writeTimeline
  };
}
