/**
 * Rule-6 invariant guard (source-text scan, no execution).
 *
 * Rule 6: "Core never names a specific extension in logic." The `'zana'` /
 * `"zana"` module-id LITERAL must NOT appear in core renderer CODE at all.
 * First-party plugins live under `plugins/` and must not be named from
 * `apps/app/src` except via `APP_MODULES` registration (`docs`).
 *
 * This walks `apps/app/src/**` `*.ts` / `*.tsx`, STRIPS comments + JSDoc, and
 * matches only the bare quoted module-id token `'zana'` / `"zana"` — so:
 *   - product-name prose ("Zana Command Center" in App.tsx),
 *   - `.zana`-path prose (AgentLauncher.tsx, doctorPrompt.ts),
 *   never trip it (they're all comments/prose, blanked before matching).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const RENDERER_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The bare quoted module-id token — NOT prose, NOT `.zana` paths. */
const ZANA_LITERAL = /(['"])zana\1/;

/** Strip block comments + JSDoc + line comments so we scan CODE, not prose. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/** Recursively collect `*.ts` / `*.tsx` under `dir`, skipping `__tests__`. */
function collectSources(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === '__tests__') continue;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...collectSources(full));
    } else if (/\.tsx?$/.test(ent.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Find every offending `file:line` for the bare module-id token in code. */
function findOffenders(): string[] {
  const offenders: string[] = [];
  for (const file of collectSources(RENDERER_ROOT)) {
    const rel = relative(RENDERER_ROOT, file);
    // Match line-by-line on comment-stripped source so a `file:line` is
    // reportable; blanking comment bodies (not whole lines) preserves numbering.
    const blanked = stripComments(readFileSync(file, 'utf8'));
    blanked.split('\n').forEach((line, i) => {
      if (ZANA_LITERAL.test(line)) offenders.push(`${rel}:${i + 1}`);
    });
  }
  return offenders;
}

describe("Rule 6 — the 'zana' module-id literal never appears in core renderer code", () => {
  it('is fully zana-free: no bare module-id literal anywhere in apps/app/src', () => {
    const offenders = findOffenders();
    expect(
      offenders,
      offenders.length === 0
        ? ''
        : `Rule 6 violation: the module-id literal 'zana' appears in core ` +
            `renderer code. Core must never name a first-party plugin id:\n` +
            offenders.map((o) => `  - apps/app/src/${o}`).join('\n') +
            `\n\nFix: keep plugin-specific logic in the plugin. If core genuinely needs ` +
            `to reference the id (it should not), reconsider the design.`
    ).toEqual([]);
  });
});
