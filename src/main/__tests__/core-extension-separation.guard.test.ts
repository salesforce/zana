/**
 * Core-extension separation guard — proves extensions are cleanly separable from
 * core and install at runtime (into ~/.zcc/extensions), never compiled into the
 * app bundle.
 *
 * This test complements the Rule-6 guard (`src/renderer/__tests__/rule6-zana-literal.guard.test.ts`,
 * which ensures renderer logic doesn't name extension module-ids in source). Here
 * we prove the IMPORT-GRAPH invariant: core's source never statically imports from
 * the first-party extension sources under `extensions/*` at repo root.
 *
 * Background: `extensions/*` houses first-party disk-extension source code (e.g.,
 * `extensions/consensus/`, `extensions/zana/`). These are NOT compiled into the app
 * bundle — they are built + packaged + installed into `~/.zcc/extensions/<id>` at
 * runtime (dev: via `seed-extensions.mjs` in predev/prestart; prod: via the
 * extension installer + marketplace). Core discovers them at runtime via
 * `discovery.ts` scanning `~/.zcc/extensions`, loads them out-of-process via
 * `utilityProcess`, and gates them via the permission broker. Core never imports
 * their source.
 *
 * Contrast with `plugins/*` (built-in modules like `plugins/zana/`, `plugins/slack/`)
 * — these ARE compiled in and registered in `MAIN_MODULES` (`src/main/modules/index.ts`).
 * The `plugins/*` directory is explicitly watched in `electron.vite.config.ts`
 * (line 66: `watch: { include: ['src/**', 'plugins/**'] }`), confirming that
 * plugins are dev-watched and bundled as part of core. Extensions are NOT watched
 * there — they rebuild via their own per-extension watchers or the one-shot
 * seed-extensions.mjs script.
 *
 * The two invariants we guard:
 *   (a) Core logic (src/**) contains no static imports from extension source
 *       (extensions/*). Imports from `src/main/extensions/*` (the runtime extension
 *       INFRASTRUCTURE — discovery, loader, broker, process-host) are fine — that's
 *       core-owned code, not extension source.
 *   (b) Core boots and its test suite passes with ZERO extensions installed
 *       (empty ~/.zcc/extensions). Extensions are optional add-ons, never required
 *       dependencies. (Out of scope for this guard — see the end-to-end boot test
 *       or e2e suite; this is a static source-text assertion.)
 *
 * This is a B4 source-text scan, like the Rule-6 guard — no execution, no mocking.
 * Failures indicate a regression where core accidentally imported extension source,
 * which would couple the build to a specific extension and violate the separation
 * guarantee.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..', '..', '..');
const srcRoot = join(repoRoot, 'src');
const extensionsRoot = join(repoRoot, 'extensions');

/**
 * Match static ES6/CommonJS imports from the repo-root `extensions/*` directory.
 * Covers:
 *   - import { foo } from '../../../extensions/consensus/...'
 *   - import * as bar from '../../extensions/zana/...'
 *   - const x = require('../../../extensions/example/...')
 *
 * Excludes:
 *   - imports from `src/main/extensions/*` (the extension infrastructure — that's
 *     core code, not extension source; paths contain `src/main/extensions` or
 *     `./extensions/` relative to src/main/)
 *   - comments and JSDoc (stripped before scanning)
 *   - string literals that aren't import statements (regex anchors on import/require)
 *
 * PATTERN NOTES:
 *   - The relative-path climb (`(\.\.\/)+`) must reach the repo root from src/ and
 *     land in `extensions/` — that's 2+ `../` from src/main/, 3+ from deeper.
 *   - We match both `extensions/` and `\/extensions\/` to catch `../../extensions/`
 *     and also `../../../extensions/` (the slash after `extensions` disambiguates
 *     it from `src/main/extensions`).
 *   - Exclude lines with `src/main/extensions` or `./extensions/` (infrastructure).
 */
const EXTENSION_SOURCE_IMPORT = /\b(?:import|require)\s*\([^)]*?(?:\.\.\/){2,}extensions\/[^)'"]+|(?:import|require).*?from\s+['"](?:\.\.\/){2,}extensions\/[^'"]+['"]/;

/**
 * Directory names under src/ that contain production source vs. tests vs. other.
 * Tests are scanned but reported separately (an import in a test is less severe
 * than in product code — tests often mock or inspect internals). We scan both,
 * but the product-code check is the hard invariant.
 */
const TEST_DIR_NAMES = new Set(['__tests__', '__mocks__']);

/** Strip block comments, JSDoc, and line comments so we scan code, not prose. */
function stripComments(src: string): string {
  // Block comments + JSDoc first (non-greedy [\s\S]*? so we don't eat the whole file)
  let stripped = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // Line comments
  stripped = stripped.replace(/\/\/.*$/gm, '');
  return stripped;
}

/** Recursively collect *.ts / *.tsx under dir, categorizing by test vs. prod. */
function collectSources(dir: string): { prod: string[]; test: string[] } {
  const prod: string[] = [];
  const test: string[] = [];
  function walk(current: string, isTest: boolean) {
    if (!existsSync(current)) return;
    for (const ent of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, ent.name);
      if (ent.isDirectory()) {
        const childIsTest = isTest || TEST_DIR_NAMES.has(ent.name);
        walk(full, childIsTest);
      } else if (/\.tsx?$/.test(ent.name)) {
        (isTest ? test : prod).push(full);
      }
    }
  }
  walk(dir, false);
  return { prod, test };
}

/**
 * Find every file:line that imports from the repo-root extensions/* directory.
 * Returns { prod: [...], test: [...] } offenders.
 */
function findImportOffenders(): { prod: string[]; test: string[] } {
  const sources = collectSources(srcRoot);
  const prod: string[] = [];
  const test: string[] = [];

  function scan(files: string[], out: string[]) {
    for (const file of files) {
      const rel = relative(repoRoot, file);
      const code = stripComments(readFileSync(file, 'utf8'));

      // Exclude lines that reference the infrastructure (src/main/extensions/...)
      const lines = code.split('\n');
      lines.forEach((line, i) => {
        // Skip if the line explicitly references src/main/extensions or ./extensions/
        // (the infrastructure paths — those are core imports)
        if (/src\/main\/extensions|\.\/extensions\//.test(line)) return;
        // Now check if it imports from the repo-root extensions/*
        if (EXTENSION_SOURCE_IMPORT.test(line)) {
          out.push(`${rel}:${i + 1}`);
        }
      });
    }
  }

  scan(sources.prod, prod);
  scan(sources.test, test);
  return { prod, test };
}

describe('Core-extension separation guard', () => {
  it('core production source (src/**) NEVER imports from first-party extension source (extensions/*)', () => {
    const offenders = findImportOffenders();
    expect(
      offenders.prod,
      offenders.prod.length === 0
        ? ''
        : `Core-extension separation violation: production source in src/ statically ` +
            `imports from the first-party extension directory (extensions/*). ` +
            `Extensions must be runtime-loaded from ~/.zcc/extensions, never bundled.\n\n` +
            `Offending imports:\n` +
            offenders.prod.map((o) => `  - ${o}`).join('\n') +
            `\n\nFix: remove the static import. If you need to reference extension ` +
            `data, load it at runtime via discovery.ts → loader.ts → ExtensionProcessHost. ` +
            `Built-in modules live in plugins/* and are registered in MAIN_MODULES ` +
            `(src/main/modules/index.ts) — only those may be statically imported by core.`
    ).toEqual([]);
  });

  it('core test source (src/**/__tests__) also never imports from extension source (best practice)', () => {
    // A less strict check — test imports are less severe than product-code imports
    // (tests often inspect internals or mock boundaries), but we still guard it:
    // if a test imports extension source, it couples the test suite to that
    // extension, which violates the "extensions are optional add-ons" invariant.
    const offenders = findImportOffenders();
    expect(
      offenders.test,
      offenders.test.length === 0
        ? ''
        : `Core-extension separation violation (test): test source in src/**/__tests__/ ` +
            `statically imports from the first-party extension directory (extensions/*). ` +
            `This couples the test suite to a specific extension.\n\n` +
            `Offending imports:\n` +
            offenders.test.map((o) => `  - ${o}`).join('\n') +
            `\n\nFix: if the test needs to exercise extension-loading, use the extension ` +
            `infrastructure (discovery, loader, process-host) to load a MOCK extension ` +
            `from a test fixture (not the real extensions/* source). See ` +
            `src/main/extensions/__tests__/*.test.ts for examples.`
    ).toEqual([]);
  });

  it('the repo-root extensions/ directory exists and contains extension source', () => {
    // Confirms this guard is asserting a real invariant — if extensions/ doesn't
    // exist or is empty, the above checks pass vacuously (nothing to import from).
    expect(existsSync(extensionsRoot)).toBe(true);
    const dirs = readdirSync(extensionsRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name);
    expect(dirs.length).toBeGreaterThan(0); // At least one first-party extension
  });

  it('seed-extensions.mjs is a predev/prestart script, NOT part of npm run build', () => {
    // Confirms the dev-time seeding convenience (seed-extensions.mjs, which builds
    // + packages extensions into ~/.zcc/extensions) is NOT hooked into the
    // production build — the build never compiles extension source.
    const pkgPath = join(repoRoot, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const { scripts } = pkg;

    // Positive assertions: seed-extensions.mjs IS run in predev and prestart
    expect(scripts.predev).toContain('seed-extensions.mjs');
    expect(scripts.prestart).toContain('seed-extensions.mjs');

    // Negative assertions: the build / dist / release scripts do NOT run it
    expect(scripts.build).not.toContain('seed-extensions');
    expect(scripts.dist).not.toContain('seed-extensions');
    expect(scripts['dist:mac']).not.toContain('seed-extensions');
    expect(scripts['release:mac']).not.toContain('seed-extensions');
    expect(scripts['release:static']).not.toContain('seed-extensions');

    // Confirm electron-vite build is the actual build command (no hidden steps)
    expect(scripts.build).toBe('electron-vite build');
  });

  it('electron.vite.config.ts watches plugins/* (built-ins) but NOT extensions/* (runtime)', () => {
    // The vite config explicitly watches `plugins/**` (built-in modules that ARE
    // bundled) but does NOT watch `extensions/**` (runtime-loaded disk extensions).
    // This proves extensions are not part of the build input.
    const viteConfigPath = join(repoRoot, 'electron.vite.config.ts');
    const viteConfig = readFileSync(viteConfigPath, 'utf8');

    // Positive: the watch clause includes plugins/**
    expect(viteConfig).toMatch(/watch:\s*\{\s*include:\s*\[[^\]]*'plugins\/\*\*'/);

    // Negative: the watch clause does NOT include extensions/**
    // (If this ever appears, it means extensions are being watched/bundled — a regression)
    expect(viteConfig).not.toMatch(/watch:\s*\{\s*include:\s*\[[^\]]*'extensions\/\*\*'/);
  });

  it('the MAIN_MODULES registry (src/main/modules/index.ts) only lists built-ins, not disk extensions', () => {
    // The MAIN_MODULES array lists modules compiled into the app (now just slack).
    // Disk extensions (gus, zana, cu, consensus, zana-hub) are loaded at runtime
    // via discovery.ts and do NOT appear in MAIN_MODULES. This proves the module
    // registry itself doesn't couple to disk-extension source.
    const registryPath = join(repoRoot, 'src', 'main', 'modules', 'index.ts');
    const registry = readFileSync(registryPath, 'utf8');

    // The sole built-in (plugins/slack) IS imported + registered.
    expect(registry).toMatch(/slackMainModule/);
    expect(registry).toMatch(/from.*plugins\/slack\/main/);

    // zana is NO LONGER a built-in — it moved to extensions/zana (a full disk
    // extension reaching data through the host MCP pool). Neither the module nor
    // its former plugins/ source may be imported by the registry anymore.
    expect(registry).not.toMatch(/zanaMainModule/);
    expect(registry).not.toMatch(/from.*plugins\/zana/);

    // Disk extensions (extensions/consensus, extensions/zana, etc.) are NOT imported.
    expect(registry).not.toMatch(/from.*extensions\/consensus/);
    expect(registry).not.toMatch(/from.*extensions\/zana/);
    expect(registry).not.toMatch(/from.*extensions\/zana-hub/);

    // The comment in index.ts explicitly states these are no longer compiled in.
    expect(registry).toContain('no longer compiled in');
    expect(registry).toContain('disk extension');
  });
});
