/**
 * Ticket 0.1 dedup invariant guard (source-text scan, no execution).
 *
 * `src/shared/launch-provider.ts` is the SINGLE source of truth for the launch
 * profile set and the "is this a Claude profile" predicate. Ticket 0.1 killed
 * every copied predicate and every duplicated profile array — but a copy is
 * easy to reintroduce (a new panel hard-codes `['shell','claude',…]`, a new
 * handler inlines `profile === 'claude' || …`). Those copies are the #1
 * silent-breakage risk when the profile set grows (add a 5th profile and the
 * stragglers silently disagree with the canonical set).
 *
 * This walks `src/main/**` + `src/renderer/**` `*.ts` / `*.tsx`, STRIPS comments
 * so we scan CODE not prose, and fails on either duplication shape reappearing
 * OUTSIDE the shared module:
 *   (1) an inline Claude-family predicate — a one-line equality chain that names
 *       BOTH 'claude-resume' AND 'claude-yolo' (the full isClaudeProfile triplet).
 *       A deliberate TWO-variant subset (e.g. `=== 'claude' || === 'claude-yolo'`
 *       that excludes claude-resume) is a DIFFERENT predicate and does NOT trip —
 *       only a re-rolled full triplet does.
 *   (2) an anonymous full profile-set array/enum — a one-line `[ … ]` naming all
 *       of 'claude-resume', 'claude-yolo', AND 'shell' (the VALID_PROFILES body),
 *       in any order. Import + use `VALID_PROFILES` (also feeds `z.enum`) instead.
 *
 * Style: source-text assertion (no run), mirroring
 * `src/renderer/__tests__/rule6-zana-literal.guard.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const SRC_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** The canonical module — the ONE place both shapes are allowed to live. */
const SHARED_MODULE = 'shared/launch-provider.ts';

/**
 * The hand-rolled isClaudeProfile body: a one-line chain that names BOTH
 * 'claude-resume' and 'claude-yolo' (order-independent). A two-variant subset
 * (excluding claude-resume) is a legitimately different predicate and is NOT
 * matched — it must mention both of the two -suffix variants to trip.
 */
const INLINE_CLAUDE_PREDICATE = (line: string): boolean =>
  /(['"])claude-resume\1/.test(line) && /(['"])claude-yolo\1/.test(line);

/**
 * The VALID_PROFILES body: a one-line array/enum literal (`[ … ]`) naming ALL
 * of the distinguishing profiles — 'claude-resume', 'claude-yolo', AND 'shell'.
 * Requiring all three avoids matching a partial subset while catching any
 * re-listing of the full set regardless of element order.
 */
const PROFILE_ARRAY = (line: string): boolean =>
  /\[[^\]]*\]/.test(line) &&
  /(['"])claude-resume\1/.test(line) &&
  /(['"])claude-yolo\1/.test(line) &&
  /(['"])shell\1/.test(line);

/** Strip block comments + JSDoc + line comments so we scan CODE, not prose. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/** Recursively collect `*.ts` / `*.tsx`, skipping `__tests__`. */
function collectSources(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === '__tests__' || ent.name === 'node_modules') continue;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...collectSources(full));
    else if (/\.tsx?$/.test(ent.name)) out.push(full);
  }
  return out;
}

function findOffenders(): string[] {
  const offenders: string[] = [];
  for (const base of ['main', 'renderer']) {
    for (const file of collectSources(join(SRC_ROOT, base))) {
      const rel = relative(SRC_ROOT, file).replace(/\\/g, '/');
      if (rel.endsWith(SHARED_MODULE)) continue;
      const blanked = stripComments(readFileSync(file, 'utf8'));
      blanked.split('\n').forEach((line, i) => {
        if (INLINE_CLAUDE_PREDICATE(line)) offenders.push(`${rel}:${i + 1} (inline isClaudeProfile)`);
        if (PROFILE_ARRAY(line)) offenders.push(`${rel}:${i + 1} (duplicated VALID_PROFILES array)`);
      });
    }
  }
  return offenders;
}

describe('Ticket 0.1 — profile set + isClaudeProfile live only in launch-provider.ts', () => {
  it('has no inline Claude predicate or duplicated profile array outside the shared module', () => {
    const offenders = findOffenders();
    expect(
      offenders,
      offenders.length === 0
        ? ''
        : `Duplicated profile logic reappeared. Import from ` +
            `'@shared/launch-provider' (isClaudeProfile / VALID_PROFILES / parseProfile) ` +
            `instead of hand-rolling it:\n` +
            offenders.map((o) => `  - src/${o}`).join('\n')
    ).toEqual([]);
  });
});
