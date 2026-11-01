import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';

/**
 * Plugin panels mount inside `.split-workspace`, which is a stacking context
 * (`z-index: 0`). A plugin's `position: fixed; inset: 0` backdrop is trapped in
 * it, so the sidebar and titlebar paint ABOVE the "modal" and stay undimmed
 * no matter how high its z-index is. Full-window overlays must portal to
 * `document.body`.
 */
const pluginsDir = new URL('../../../../plugins/', import.meta.url).pathname;
const SOURCE = /\.(tsx?|css)$/;
const SKIP = /(\.test\.|\.d\.ts$|generated\.css$|[\\/](node_modules|dist|kit|playground)[\\/])/;
const PORTAL = /createPortal|\btoBody\(|\bportal\(/;
// A single declaration block that is both fixed and anchored to every edge.
const FULLSCREEN_FIXED = /\{[^{}]*position:\s*fixed[^{}]*inset:\s*0\b[^{}]*\}|\{[^{}]*inset:\s*0\b[^{}]*position:\s*fixed[^{}]*\}/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (SKIP.test(full)) continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SOURCE.test(name)) out.push(full);
  }
  return out;
}

it('plugins that style a full-window fixed overlay portal it to document.body', () => {
  const offenders: string[] = [];
  for (const plugin of readdirSync(pluginsDir)) {
    const src = join(pluginsDir, plugin, 'src');
    try { if (!statSync(src).isDirectory()) continue; } catch { continue; }
    const files = walk(src);
    const texts = files.map((file) => [file, readFileSync(file, 'utf8')] as const);
    const overlay = texts.find(([, text]) => FULLSCREEN_FIXED.test(text));
    if (overlay && !texts.some(([, text]) => PORTAL.test(text))) offenders.push(relative(pluginsDir, overlay[0]));
  }
  expect(offenders, 'full-window fixed overlays must portal to document.body (see plugins/design-docs/src/app/portal.ts)').toEqual([]);
});

it('the guard recognises a trapped overlay', () => {
  expect(FULLSCREEN_FIXED.test('.m{position:fixed;inset:0;z-index:1000}')).toBe(true);
  expect(FULLSCREEN_FIXED.test('.m{z-index:1;inset:0;position:fixed}')).toBe(true);
  expect(FULLSCREEN_FIXED.test('.m{position:fixed;top:4px}')).toBe(false);
});
