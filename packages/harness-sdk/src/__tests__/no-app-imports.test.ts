import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Boundary guard for `@zcc/harness-sdk`: the package must stay genuinely
 * dependency-free so `npm publish` works the day we
 * choose and a standalone consumer can import it without dragging in the app.
 *
 * It fails the moment any source file grows a forbidden import:
 *  - electron / node-pty / any Node built-in (`node:*`, `fs`, `path`, …) — the
 *    package ships pure TYPE + tiny pure-fn contracts, no runtime host access;
 *  - `@shared/*` or a reach back into `src/` — app-coupled types (`AppConfig`,
 *    `Persona`, `AgentEvent`) belong in `src/main` or `@zana-ai/zcc-domain`, NOT here;
 *  - `@zana-ai/zcc-extension-sdk` — a sibling SDK, not a dependency of this one.
 *
 * The guard itself is exempt (it reads files to scan them). Scans real `import`/
 * `export … from` specifiers only, so a mention inside a comment/string doesn't
 * trip it.
 */

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Recursively collect every .ts file under src/, excluding __tests__. */
function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__') continue;
      out.push(...collectSourceFiles(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Every module specifier this file imports/re-exports from (static forms). */
function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  // `import … from '<spec>'`, `export … from '<spec>'`, and bare `import '<spec>'`.
  const re = /(?:import|export)\b[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    specs.push(m[1] ?? m[2]);
  }
  return specs;
}

const FORBIDDEN: Array<{ label: string; test: (spec: string) => boolean }> = [
  { label: 'electron', test: (s) => s === 'electron' || s.startsWith('electron/') },
  { label: 'node-pty', test: (s) => s === 'node-pty' },
  { label: 'a Node built-in (node:*)', test: (s) => s.startsWith('node:') },
  {
    label: 'a bare Node built-in',
    test: (s) => ['fs', 'path', 'os', 'child_process', 'crypto', 'util', 'stream', 'events'].includes(s)
  },
  { label: '@shared/*', test: (s) => s === '@shared' || s.startsWith('@shared/') },
  { label: 'a reach into src/', test: (s) => s.includes('/src/') || s.includes('src/main') },
  { label: '@zana-ai/zcc-extension-sdk', test: (s) => s.startsWith('@zana-ai/zcc-extension-sdk') }
];

describe('@zcc/harness-sdk boundary', () => {
  const files = collectSourceFiles(SRC_DIR);

  it('ships at least the capabilities + actions contracts', () => {
    expect(files.length).toBeGreaterThanOrEqual(3); // index, capabilities, actions
  });

  it('every source file imports ONLY relative sibling specifiers (no app/electron/node deps)', () => {
    const violations: string[] = [];
    for (const file of files) {
      const specs = importSpecifiers(readFileSync(file, 'utf-8'));
      for (const spec of specs) {
        const hit = FORBIDDEN.find((f) => f.test(spec));
        if (hit) violations.push(`${file}: imports ${spec} (${hit.label})`);
      }
    }
    expect(violations).toEqual([]);
  });
});
