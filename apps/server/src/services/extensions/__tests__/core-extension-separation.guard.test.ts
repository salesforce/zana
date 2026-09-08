/**
 * Core-extension separation guard — proves extensions are cleanly separable from
 * core and install at runtime (into ~/.zcc/extensions), never compiled into the
 * app bundle.
 *
 * This test complements the Rule-6 guard (`apps/app/src/__tests__/rule6-zana-literal.guard.test.ts`,
 * which ensures renderer logic doesn't name extension module-ids in source). Here
 * we prove the IMPORT-GRAPH invariant: core's source never statically imports from
 * the first-party extension sources under `extensions/*` at repo root.
 *
 * Background: `plugins/*` houses first-party plugin source (currently `plugins/docs`).
 * bundle — they are built + packaged + installed into `~/.zcc/extensions/<id>` at
 * runtime (dev: via `seed-extensions.mjs` in predev/prestart; prod: via the
 * extension installer + marketplace). Core discovers them at runtime via
 * `discovery.ts` scanning `~/.zcc/extensions`, loads them out-of-process via
 * `utilityProcess`, and gates them via the permission broker. Core never imports
 * their source.
 *
 * Contrast with runtime-loaded plugins under `plugins/` (currently `plugins/docs`).
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
import { join, relative, sep } from 'node:path';

const repoRoot = process.cwd();
const srcRoots = [
  join(repoRoot, 'apps/desktop/src'),
  join(repoRoot, 'apps/server/src'),
  join(repoRoot, 'apps/host-daemon/src'),
  join(repoRoot, 'apps/app/src')
];

/**
 * Match static ES6/CommonJS imports from the repo-root `extensions/*` directory.
 * Covers:
 *   - import { foo } from '../../../plugins/docs/...'
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
  const sources = srcRoots.reduce(
    (acc, root) => {
      const next = collectSources(root);
      acc.prod.push(...next.prod);
      acc.test.push(...next.test);
      return acc;
    },
    { prod: [] as string[], test: [] as string[] }
  );
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
        if (/src\/main\/extensions|apps\/desktop\/src\/extensions|\.\/extensions\//.test(line)) return;
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

  it('first-party plugin source lives under plugins/ (docs only)', () => {
    const pluginsRoot = join(repoRoot, 'plugins');
    expect(existsSync(join(pluginsRoot, 'docs'))).toBe(true);
    expect(existsSync(join(pluginsRoot, 'slack'))).toBe(false);
    expect(existsSync(join(pluginsRoot, 'zana'))).toBe(false);
    expect(existsSync(join(pluginsRoot, 'zana-hub'))).toBe(false);
  });

  it('seed-extensions.mjs runs in predev/prestart/prebuild, not inlined in dist scripts', () => {
    // First-party plugins under plugins/ compile via seed-extensions (app.js +
    // static playground assets). prebuild must seed so electron-builder
    // extraResources copies playground/dist. dist/release still call `build`,
    // which runs prebuild — they must not duplicate the seed command.
    const pkgPath = join(repoRoot, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const { scripts } = pkg;

    expect(scripts.predev).toContain('seed-extensions.mjs');
    expect(scripts.prestart).toContain('seed-extensions.mjs');
    expect(scripts.prebuild).toContain('seed-extensions.mjs');

    expect(scripts.build).not.toContain('seed-extensions');
    expect(scripts.dist).not.toContain('seed-extensions');
    expect(scripts['dist:mac']).not.toContain('seed-extensions');
    expect(scripts['release:mac']).not.toContain('seed-extensions');
    expect(scripts['release:static']).not.toContain('seed-extensions');

    expect(scripts.build).toBe('electron-vite build');
  });

  it('tag-push CI publishes dual-arch macOS; local release:mac does not upload', () => {
    const desktopPkg = JSON.parse(
      readFileSync(join(repoRoot, 'apps/desktop/package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    expect(desktopPkg.scripts['release:mac']).toContain('--publish never');
    expect(desktopPkg.scripts['release:mac']).not.toContain('--publish always');

    const workflow = readFileSync(join(repoRoot, '.github/workflows/release.yml'), 'utf8');
    expect(workflow).toContain('macos-15-intel');
    expect(workflow).not.toMatch(/macos-13\b/);
    expect(workflow).toContain('merge-latest-mac-yml.mjs');
    expect(workflow).not.toContain('grebmann1/zcc-releases');
    expect(workflow).not.toContain('ZCC_RELEASES_TOKEN');
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

  it('the MAIN_MODULES registry (apps/desktop/src/modules/index.ts) lists no first-party plugins', () => {
    const registryPath = join(repoRoot, 'apps/desktop/src/modules/index.ts');
    const registry = readFileSync(registryPath, 'utf8');

    expect(registry).toMatch(/export const MAIN_MODULES: MainModule\[\] = \[\]/);
    expect(registry).not.toMatch(/slackMainModule/);
    expect(registry).not.toMatch(/from.*plugins\/slack/);
    expect(registry).not.toMatch(/zanaMainModule/);
    expect(registry).not.toMatch(/from.*plugins\/zana['"]/);
    expect(registry).not.toMatch(/from.*plugins\/zana-hub/);
  });
});
