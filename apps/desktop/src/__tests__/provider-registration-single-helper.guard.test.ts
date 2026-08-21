import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * EPIC A / A.1 guard (source-text scan, no execution).
 *
 * The three LLM providers (`claude-cli`, `openai`, `gemini`) have exactly ONE
 * construction site: the private `rebuildProviders(config)` closure in
 * `apps/desktop/src/host.ts`. That single code path is invoked from the 3 lifecycle
 * sites (`config:set` and post-migration bootstrap) so provider wiring can
 * never drift between them or read routing config before migration completes.
 *
 * The `openai`/`gemini` providers take a LAZY key getter, so a key add/remove
 * takes effect at call-time WITHOUT a rebuild — that's why `config:set` only
 * rebuilds on a `claudeBinary` change. This guard's job is to make sure nobody
 * re-inlines `new XxxProvider(...)` back at a call site (the pre-A.1 shape),
 * which would silently reintroduce the drift this ticket removed.
 *
 * `rebuildProviders` is a private closure inside the ~270KB `index.ts` (not
 * exportable), so — following the codebase's established source-text guard
 * pattern (see `skill-provider-registry.guard.test.ts`) — we scan the
 * comment-stripped source rather than executing it.
 */

const REPO_ROOT = process.cwd();
const INDEX_REL = 'apps/desktop/src/host.ts';

/** The three LLM provider constructor call fragments. */
const PROVIDER_CTORS = [
  'new ClaudeCliProvider(',
  'new OpenAiProvider(',
  'new GeminiProvider('
];

const FN_DEF = 'function rebuildProviders(';
const FN_CALL = 'rebuildProviders(';

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

/** Line indices (1-based) of every line that contains `needle`. */
function linesContaining(lines: string[], needle: string): number[] {
  const hits: number[] = [];
  lines.forEach((line, i) => {
    if (line.includes(needle)) hits.push(i + 1);
  });
  return hits;
}

describe('EPIC A / A.1 — providers are built ONLY inside rebuildProviders()', () => {
  const raw = readFileSync(join(REPO_ROOT, INDEX_REL), 'utf8');
  const code = stripComments(raw);
  const lines = code.split('\n');

  // Locate the single rebuildProviders definition and its body [start, end].
  const defLines = linesContaining(lines, FN_DEF);

  it('defines rebuildProviders exactly once', () => {
    expect(
      defLines.length,
      `Expected exactly ONE \`${FN_DEF}\` definition in ${INDEX_REL}, found ` +
        `${defLines.length} at line(s) ${defLines.join(', ') || '(none)'}. ` +
        `A.1 unified provider registration into a single helper — do not add a second.`
    ).toBe(1);
  });

  it('constructs each LLM provider EXACTLY once', () => {
    for (const ctor of PROVIDER_CTORS) {
      const n = countOccurrences(code, ctor);
      expect(
        n,
        `Expected exactly ONE \`${ctor}\` in ${INDEX_REL}, found ${n}. ` +
          `The three LLM providers must be constructed ONLY inside rebuildProviders() ` +
          `(A.1 single-helper invariant). A second occurrence means a provider ctor was ` +
          `re-inlined at a call site — move it back into rebuildProviders().`
      ).toBe(1);
    }
  });

  it('places every provider constructor inside the rebuildProviders body', () => {
    expect(defLines.length).toBe(1);
    const defLine = defLines[0];

    // Find the body brace range by counting braces from the def line onward.
    let start = -1;
    let end = -1;
    let depth = 0;
    let seenOpen = false;
    for (let i = defLine - 1; i < lines.length; i += 1) {
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

    expect(start, 'could not locate rebuildProviders opening brace').toBeGreaterThan(0);
    expect(end, 'could not locate rebuildProviders closing brace').toBeGreaterThan(start);

    for (const ctor of PROVIDER_CTORS) {
      const at = linesContaining(lines, ctor);
      expect(at.length, `expected one \`${ctor}\``).toBe(1);
      const ctorLine = at[0];
      expect(
        ctorLine > start && ctorLine < end,
        `\`${ctor}\` is at line ${ctorLine}, OUTSIDE the rebuildProviders body ` +
          `(${start}..${end}) in ${INDEX_REL}. All LLM provider construction must ` +
          `live inside rebuildProviders() — that is the A.1 single-helper invariant.`
      ).toBe(true);
    }
  });

  it('invokes rebuildProviders only from post-migration bootstrap and config updates', () => {
    expect(defLines.length).toBe(1);
    const defLine = defLines[0];
    const callLines = linesContaining(lines, FN_CALL).filter(
      (ln) => ln !== defLine && !/get\s+rebuildProviders\s*\(/.test(lines[ln - 1] ?? '')
    );
    expect(callLines.length, `Expected post-migration bootstrap call in host.ts, found line(s) ${callLines.join(', ') || '(none)'}`).toBe(1);
    const configIpc = readFileSync(join(REPO_ROOT, 'apps/desktop/src/ipc/config.ts'), 'utf8');
    expect(configIpc).toMatch(/IPC\.config\.set,[\s\S]*rebuildProviders\(next\)/);
    expect(code).toMatch(/function bootstrapNormal\(\)[\s\S]*rebuildProviders\(store\.getConfig\(\)\)/);
  });
});
