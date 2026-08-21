import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Gating guard (source-text scan, no execution).
 *
 * The test-observability tap ships ALWAYS-COMPILED but must be a true no-op in
 * production — armed ONLY when `ZCC_E2E` is set at boot. That contract is
 * enforced by a handful of `if (E2E_TAP_ENABLED)` gates in `apps/desktop/src/host.ts`
 * plus a `process.argv.includes('--zcc-e2e')` gate in `apps/desktop/src/preload.ts`.
 * If someone later un-gates any of these — moves `testTap.enable()` onto the
 * unconditional boot path, registers `IPC.test.*` handlers outside the gate, or
 * exposes `window.__zccTest` unconditionally — the tap becomes a live,
 * un-gated surface in shipped builds. This guard fails loudly if that happens.
 *
 * Following the codebase's established source-text guard pattern
 * (`provider-registration-single-helper.guard.test.ts`): scan the
 * comment-stripped source (these are private closures inside ~270KB `index.ts`,
 * not exportable) and brace-scan the `if (E2E_TAP_ENABLED)` bodies.
 */

const REPO_ROOT = process.cwd();
const INDEX_REL = 'apps/desktop/src/host.ts';
const PRELOAD_REL = 'apps/desktop/src/preload.ts';

const GATE = 'if (E2E_TAP_ENABLED)';
const PRELOAD_GATE = "if (process.argv.includes('--zcc-e2e'))";

/** Blank out comments so we scan CODE not prose (keeps line numbers stable). */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/.*$/gm, '');
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

function linesContaining(lines: string[], needle: string): number[] {
  const hits: number[] = [];
  lines.forEach((line, i) => {
    if (line.includes(needle)) hits.push(i + 1);
  });
  return hits;
}

/**
 * Given a 1-based line that opens an `if (...) {` block, return the [start,end]
 * 1-based line range of that block's body (brace-balanced from the first `{`).
 */
function blockRange(lines: string[], headerLine: number): [number, number] {
  let start = -1;
  let end = -1;
  let depth = 0;
  let seenOpen = false;
  for (let i = headerLine - 1; i < lines.length; i += 1) {
    for (const ch of lines[i]) {
      if (ch === '{') {
        if (!seenOpen) {
          seenOpen = true;
          start = i + 1;
        }
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
        if (seenOpen && depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end !== -1) break;
  }
  return [start, end];
}

/** True if `line` sits strictly inside ANY of the given [start,end] ranges. */
function withinAny(ranges: Array<[number, number]>, line: number): boolean {
  return ranges.some(([s, e]) => s > 0 && e > s && line > s && line < e);
}

describe('test-tap gating guard — the tap surface stays behind its flags', () => {
  const indexCode = stripComments(readFileSync(join(REPO_ROOT, INDEX_REL), 'utf8'));
  const indexLines = indexCode.split('\n');
  const preloadCode = stripComments(readFileSync(join(REPO_ROOT, PRELOAD_REL), 'utf8'));
  const preloadLines = preloadCode.split('\n');

  const gateHeaders = linesContaining(indexLines, GATE);
  const gateRanges = gateHeaders.map((ln) => blockRange(indexLines, ln));

  it('defines E2E_TAP_ENABLED exactly once from the ZCC_E2E env flag', () => {
    const defs = linesContaining(indexLines, 'const E2E_TAP_ENABLED =');
    expect(defs.length, `expected ONE E2E_TAP_ENABLED definition in ${INDEX_REL}`).toBe(1);
    const defLine = indexLines[defs[0] - 1];
    expect(defLine).toContain('process.env.ZCC_E2E');
  });

  it('records events at EXACTLY one site (the safeSend choke point)', () => {
    const n = countOccurrences(indexCode, 'testTap.record(');
    expect(
      n,
      `Expected exactly ONE \`testTap.record(\` call in ${INDEX_REL} (only in ` +
        `safeSend), found ${n}. A second tap site means events are captured from ` +
        `more than the single fan-out choke point.`
    ).toBe(1);
  });

  it('arms the tap (testTap.enable) ONLY inside an if (E2E_TAP_ENABLED) gate', () => {
    const enableLines = linesContaining(indexLines, 'testTap.enable(');
    expect(enableLines.length, 'expected exactly one testTap.enable() call').toBe(1);
    const at = enableLines[0];
    // Either guarded by an inline `if (E2E_TAP_ENABLED) testTap.enable()` on the
    // same line, or nested inside an if(E2E_TAP_ENABLED) { ... } block.
    const sameLineGated = indexLines[at - 1].includes(GATE);
    expect(
      sameLineGated || withinAny(gateRanges, at),
      `testTap.enable() at line ${at} in ${INDEX_REL} is NOT gated by ` +
        `\`${GATE}\`. The tap must never arm on an unconditional production boot.`
    ).toBe(true);
  });

  it('registers every IPC.test.* handler ONLY inside an if (E2E_TAP_ENABLED) gate', () => {
    const modulesRel = 'apps/desktop/src/ipc/modules.ts';
    const modulesCode = stripComments(readFileSync(join(REPO_ROOT, modulesRel), 'utf8'));
    const modulesLines = modulesCode.split('\n');
    const handlerLines = linesContaining(modulesLines, 'ipcMain.handle(IPC.test.');
    expect(
      handlerLines.length,
      `expected the 3 gated test IPC handlers (drainEvents/snapshot/reset) in ${modulesRel}`
    ).toBeGreaterThanOrEqual(3);
    const modulesGateHeaders = linesContaining(modulesLines, 'if (ctx.E2E_TAP_ENABLED)');
    const modulesGateRanges = modulesGateHeaders.map((ln) => blockRange(modulesLines, ln));
    for (const ln of handlerLines) {
      expect(
        withinAny(modulesGateRanges, ln),
        `ipcMain.handle(IPC.test.*) at line ${ln} in ${modulesRel} is OUTSIDE ` +
          `every \`if (ctx.E2E_TAP_ENABLED)\` block. The test IPC surface must be absent in prod.`
      ).toBe(true);
    }
  });

  it('exposes window.__zccTest in preload ONLY behind the --zcc-e2e argv gate', () => {
    const exposeLines = linesContaining(preloadLines, "exposeInMainWorld('__zccTest'");
    expect(
      exposeLines.length,
      `expected exactly ONE window.__zccTest exposure in ${PRELOAD_REL}`
    ).toBe(1);
    const gateLines = linesContaining(preloadLines, PRELOAD_GATE);
    expect(gateLines.length, `expected the --zcc-e2e argv gate in ${PRELOAD_REL}`).toBe(1);
    const [start, end] = blockRange(preloadLines, gateLines[0]);
    const at = exposeLines[0];
    expect(
      at > start && at < end,
      `window.__zccTest exposure at line ${at} in ${PRELOAD_REL} is OUTSIDE the ` +
        `\`${PRELOAD_GATE}\` block (${start}..${end}). In production the bridge must ` +
        `be undefined.`
    ).toBe(true);
  });
});
