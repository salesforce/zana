/**
 * Rule-6 guard for the LAUNCH LAYER.
 *
 * After the LaunchProvider seam extraction, `pty.ts` must dispatch every
 * provider-identity decision through the registry + the `ProviderCapabilities`
 * descriptor — it must NOT branch on concrete launch-profile literals in its
 * launch logic. Concrete profile ids (`'claude'`, `'claude-resume'`,
 * `'claude-yolo'`, `'shell'`) and the provider id (`'claude-code'`) may appear
 * ONLY inside the provider implementations and the registry — the launch layer's
 * registration seam (mirroring the `MAIN_MODULES` / Rule-6-zana-literal guards).
 *
 * This is a B4 source-text scan (comment-stripped, no execution): a regression
 * where someone adds `effectiveProfile === 'claude-yolo'` back into `pty.ts`
 * instead of reading `caps.acceptsPermissionMode` fails here loudly.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const mainRoot = join(__dirname, '..');

/** Strip block/line comments and (crudely) string literals so we scan CODE. */
function stripCommentsAndStrings(src: string): string {
  let s = src.replace(/\/\*[\s\S]*?\*\//g, '');
  s = s.replace(/\/\/.*$/gm, '');
  return s;
}

/**
 * A provider-identity COMPARISON: `x === 'claude-yolo'`, `'shell' === y`,
 * `!== 'claude-resume'`, etc. against any of the four profile literals. This is
 * the shape the seam replaced with capability reads — its reappearance in the
 * launch layer is the regression we guard against. Matches both quote styles and
 * either operand order.
 */
const PROFILE_LITERALS = [
  'claude',
  'claude-resume',
  'claude-yolo',
  'cursor',
  'cursor-resume',
  'codex',
  'codex-resume',
  'pi',
  'pi-resume',
  'shell'
];
function findProfileComparisons(code: string): string[] {
  const hits: string[] = [];
  const lines = code.split('\n');
  const litAlt = PROFILE_LITERALS.map((l) => l.replace(/-/g, '\\-')).join('|');
  // `=== 'literal'` / `!== 'literal'` / `== 'literal'` and the reversed order.
  const rhs = new RegExp(`[!=]==?\\s*['"](?:${litAlt})['"]`);
  const lhs = new RegExp(`['"](?:${litAlt})['"]\\s*[!=]==?`);
  lines.forEach((line, i) => {
    if (rhs.test(line) || lhs.test(line)) hits.push(`${i + 1}: ${line.trim()}`);
  });
  return hits;
}

describe('Rule-6 guard — launch layer dispatches through the provider seam', () => {
  it('pty.ts launch logic contains NO bare launch-profile comparisons', () => {
    const code = stripCommentsAndStrings(readFileSync(join(mainRoot, 'pty.ts'), 'utf8'));
    const hits = findProfileComparisons(code);
    expect(
      hits,
      hits.length === 0
        ? ''
        : `pty.ts branches on a concrete launch-profile literal in its launch logic. ` +
            `The LaunchProvider seam means these decisions must read a capability ` +
            `(provider.capabilities(profile).*) or call a provider method, NOT compare ` +
            `the profile string. Move the branch behind the provider interface ` +
            `(src/main/harness/) or add a ProviderCapabilities field.\n\n` +
            `Offending lines:\n` +
            hits.map((h) => `  pty.ts:${h}`).join('\n')
    ).toEqual([]);
  });

  it("the 'claude-code' provider-id LITERAL appears ONLY in the provider + registry, never in pty.ts", () => {
    // The exact quoted provider-id token — not the substring, which also occurs
    // in the legitimate `./harness/claude/provider.js` import path.
    const code = stripCommentsAndStrings(readFileSync(join(mainRoot, 'pty.ts'), 'utf8'));
    expect(/['"]claude-code['"]/.test(code)).toBe(false);
  });

  it('the harness seam files exist (interface + registry + harness-local providers)', () => {
    for (const f of [
      'harness/launch-provider.ts',
      'harness/base-provider.ts',
      'harness/registry.ts',
      'harness/argv-utils.ts',
      'harness/claude/provider.ts',
      'harness/cursor/provider.ts',
      'harness/codex/provider.ts',
      'harness/pi/provider.ts',
      'harness/opencode/provider.ts',
      'harness/shell/provider.ts',
      'harness/shell-quote.ts'
    ]) {
      expect(() => readFileSync(join(mainRoot, f), 'utf8')).not.toThrow();
    }
  });
});
