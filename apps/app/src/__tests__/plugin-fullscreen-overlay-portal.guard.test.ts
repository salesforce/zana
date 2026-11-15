import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readSourceText } from './helpers/source-text.js';

/**
 * Plugin panels mount inside `.split-workspace`, which is a stacking context
 * (`z-index: 0`). A plugin's `position: fixed; inset: 0` backdrop is trapped in
 * it, so the sidebar and titlebar paint ABOVE the "modal" and stay undimmed
 * no matter how high its z-index is.
 *
 * A full-window overlay is safe when it either portals to `document.body`, or
 * carries a marker the shell's content-track lift recognises (`global.css`,
 * `.shell-main > :has(...)`): `aria-modal="true"`, `.modal-backdrop` or
 * `.palette-backdrop`. The check is per file: every file that renders such an
 * overlay (inline style, Tailwind `fixed inset-0`, or a class whose CSS rule is
 * full-window) must portal or carry a marker itself.
 */
const pluginsDir = fileURLToPath(new URL('../../../../plugins/', import.meta.url));
const SOURCE = /\.(tsx?|css)$/;
const SKIP = /(\.test\.|\.d\.ts$|generated\.css$|[\\/](node_modules|dist|kit|playground)[\\/])/;

export const PORTAL = /createPortal\(|\btoBody\(|\bportal\(|<[\w.]*Portal\b/;
export const MODAL_MARKER =
  /aria-modal=(?:"true"|'true'|\{true\})|["']aria-modal["']\s*:\s*(?:true|["']true["'])|\bmodal-backdrop\b|\bpalette-backdrop\b/;
// A single declaration block (CSS rule or style object) fixed to every edge.
const FIXED = String.raw`position:\s*['"]?fixed\b`;
const INSET = String.raw`inset:\s*['"]?0\b`;
export const FULLSCREEN_BLOCK = new RegExp(String.raw`\{[^{}]*(?:${FIXED}[^{}]*${INSET}|${INSET}[^{}]*${FIXED})[^{}]*\}`, 'g');
export const TAILWIND_FULLSCREEN = /["'`][^"'`\n]*(?:\bfixed\b[^"'`\n]*\binset-0\b|\binset-0\b[^"'`\n]*\bfixed\b)[^"'`\n]*["'`]/;

/** Class names of a full-window CSS rule, or `null` when the block is a style object. */
export function cssOverlayClasses(text: string, blockStart: number): string[] | null {
  const before = text.slice(0, blockStart);
  const boundary = Math.max(before.lastIndexOf('}'), before.lastIndexOf('{'), before.lastIndexOf('*/'), before.lastIndexOf('`'));
  const selector = before.slice(boundary + 1);
  if (/[=;]/.test(selector)) return null;
  const classes = [...selector.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]);
  return classes.length > 0 ? classes : null;
}

export function usesClass(text: string, cls: string): boolean {
  const escaped = cls.replace(/[-]/g, '\\-');
  return new RegExp(String.raw`className=(?:"[^"]*|'[^']*|\{[^}]*)\b${escaped}\b`).test(text);
}

export function findTrappedOverlays(files: ReadonlyArray<readonly [string, string]>): string[] {
  const safe = (text: string) => PORTAL.test(text) || MODAL_MARKER.test(text);
  const offenders = new Set<string>();
  for (const [file, text] of files) {
    if (TAILWIND_FULLSCREEN.test(text) && !safe(text)) offenders.add(`${file} (fixed inset-0)`);
    for (const block of text.matchAll(FULLSCREEN_BLOCK)) {
      const classes = cssOverlayClasses(text, block.index);
      if (classes === null) {
        if (!safe(text)) offenders.add(`${file} (inline fixed overlay)`);
        continue;
      }
      for (const cls of classes) {
        for (const [user, userText] of files) {
          if (usesClass(userText, cls) && !safe(userText)) offenders.add(`${user} (.${cls})`);
        }
      }
    }
  }
  return [...offenders].sort();
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (SKIP.test(full)) continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SOURCE.test(name)) out.push(full);
  }
  return out;
}

describe('plugin full-window overlays', () => {
  it('portal to document.body or carry a modal marker the shell lifts', () => {
    const offenders: string[] = [];
    for (const plugin of readdirSync(pluginsDir)) {
      const root = join(pluginsDir, plugin);
      if (!statSync(root).isDirectory()) continue;
      const files = walk(root).map((file) => [relative(pluginsDir, file), readFileSync(file, 'utf8')] as const);
      offenders.push(...findTrappedOverlays(files));
    }
    expect(
      offenders,
      'full-window fixed overlays must portal to document.body (plugins/design-docs/src/app/portal.ts) or set aria-modal="true"'
    ).toEqual([]);
  });

  it('accepts exactly the markers the shell content-track lift recognises', () => {
    const css = readSourceText(new URL('../styles/global.css', import.meta.url));
    const lift = /\.shell-main > :has\(:is\(([^)]*)\)\)/.exec(css)?.[1];
    expect(lift, 'content-track lift rule in global.css').toBeDefined();
    expect(lift!.split(/,\s*/)).toEqual(["[aria-modal='true']", '.modal-backdrop', '.palette-backdrop']);
  });

  it('recognises trapped overlays in every authoring style', () => {
    expect('.m{position:fixed;inset:0;z-index:1000}'.match(FULLSCREEN_BLOCK)).toHaveLength(1);
    expect('.m{z-index:1;inset:0;position:fixed}'.match(FULLSCREEN_BLOCK)).toHaveLength(1);
    expect('const s = { position: "fixed", inset: 0 }'.match(FULLSCREEN_BLOCK)).toHaveLength(1);
    expect('.m{position:fixed;top:4px}'.match(FULLSCREEN_BLOCK)).toBeNull();
    expect(TAILWIND_FULLSCREEN.test('<div className="fixed inset-0 z-50">')).toBe(true);
    expect(TAILWIND_FULLSCREEN.test('<div className="absolute inset-0">')).toBe(false);

    expect(findTrappedOverlays([['a.tsx', '<div role="dialog" className="fixed inset-0" />']])).toEqual(['a.tsx (fixed inset-0)']);
    expect(findTrappedOverlays([['a.tsx', 'const s = { position: "fixed", inset: 0 }; <div style={s} />']])).toEqual([
      'a.tsx (inline fixed overlay)'
    ]);
    expect(
      findTrappedOverlays([
        ['styles.css', '.x-backdrop {\n  position: fixed;\n  inset: 0;\n}'],
        ['Menu.tsx', 'portal(<div className="x-backdrop" />)'],
        ['Dialog.tsx', '<div className="x-backdrop" />']
      ])
    ).toEqual(['Dialog.tsx (.x-backdrop)']);
  });

  it('accepts portals and modal markers', () => {
    for (const text of [
      'createPortal(<div className="fixed inset-0" />, document.body)',
      'toBody(<div className="fixed inset-0" />)',
      '<DialogPrimitive.Portal><div className="fixed inset-0" /></DialogPrimitive.Portal>',
      '<div className="fixed inset-0" role="dialog" aria-modal="true" />',
      '<div className="fixed inset-0" aria-modal={true} />',
      'h("div", { className: "fixed inset-0", "aria-modal": "true" })',
      '<div className="palette-backdrop fixed inset-0" />'
    ]) {
      expect(findTrappedOverlays([['a.tsx', text]]), text).toEqual([]);
    }
  });

  it('treats only selector text as a CSS rule', () => {
    const css = '/* c */ .a,\n.b:hover > .c { position: fixed; inset: 0 }';
    expect(cssOverlayClasses(css, css.indexOf('{'))).toEqual(['a', 'b', 'c']);
    const obj = 'const s: React.CSSProperties = { position: "fixed", inset: 0 }';
    expect(cssOverlayClasses(obj, obj.indexOf('{'))).toBeNull();
    expect(usesClass('<div className={cn("x-backdrop", y)} />', 'x-backdrop')).toBe(true);
    expect(usesClass('<div className="x-backdrop-inner" />', 'x-backdrop')).toBe(true);
    expect(usesClass('const x = "x-backdrop"', 'x-backdrop')).toBe(false);
  });
});
