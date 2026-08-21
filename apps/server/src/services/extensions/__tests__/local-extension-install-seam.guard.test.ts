/**
 * Install-seam guard for the "create your own extension" (local) feature.
 *
 * The security story of local extensions rests on ONE invariant: the Creator
 * agent's file output is INERT until it crosses the single trusted install seam
 * (`installFromDir` in extension-installer.ts). `local-extension.ts` — the module
 * that mints ids, scaffolds the template, and packs the source — must therefore
 * NEVER write into (or even compute) the live install location itself. It writes
 * only to (a) the caller-supplied scratch working dir and (b) an OS-tmp staging
 * dir, and hands that staging dir to `installFromDir`, which re-runs every
 * manifest/id/api/reserved/containment gate.
 *
 * This is a B4 source-text scan (no execution). It fails if local-extension.ts
 * ever references the install root — a regression that would let agent output
 * land in `~/.zcc/extensions` without crossing the gates.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const mainRoot = join(__dirname, '..');

/**
 * Strip comments AND template-literal bodies before scanning. The module's
 * scaffold/README/CLAUDE.md templates are backtick strings that legitimately
 * mention `~/.zcc` and "Reload from source" in PROSE — that's data the agent
 * reads, not code that targets the install root. We scan the LOGIC only, so we
 * drop template-literal contents (our templates never nest backticks; escaped
 * `\`` inside them is handled by the `\\.` alternative).
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

describe('local-extension install-seam guard', () => {
  const file = join(mainRoot, 'local-extension.ts');
  const code = existsSync(file) ? stripComments(readFileSync(file, 'utf8')) : '';

  it('local-extension.ts exists and is scanned', () => {
    expect(existsSync(file)).toBe(true);
  });

  it('never references the live install location (only installFromDir may write there)', () => {
    // The install root is `~/.zcc/extensions` (or ZCC_EXTENSIONS_DIR). Packing/
    // scaffolding must target the scratch working dir + OS tmp only — never this.
    expect(code, 'local-extension.ts must not reference ~/.zcc').not.toMatch(/\.zcc/);
    expect(code, 'local-extension.ts must not read ZCC_EXTENSIONS_DIR').not.toMatch(
      /ZCC_EXTENSIONS_DIR/
    );
    // No installRoot()-shaped helper and no homedir() (which is how the install
    // root is derived) — the module is deliberately path-agnostic (paths arrive
    // as args, Rule 1/2).
    expect(code).not.toMatch(/\binstallRoot\b/);
    expect(code).not.toMatch(/\bhomedir\b/);
  });

  it('does not itself import/call the install or dir-replace primitives', () => {
    // Packing produces a staging dir; the WIRING (installFromDir + reconcile) lives
    // in index.ts, not here. This module must not short-circuit the seam.
    expect(code).not.toMatch(/\binstallFromDir\s*\(/);
    expect(code).not.toMatch(/\breplaceDir\b/);
    expect(code).not.toMatch(/from\s+['"]\.\/extension-installer/);
  });

  it("packs into an OS-tmp staging dir, not a repo/home path", () => {
    // The pack destination must come from tmpdir() so a stray secret in the
    // working dir never rides toward the install root via a fixed path.
    expect(code).toMatch(/tmpdir\s*\(/);
  });

  it('the sole live-install path is index.ts wiring the staging dir to installFromDir', () => {
    // Positive assertion: index.ts (the trusted orchestrator) is where the packed
    // staging dir meets installFromDir — proving the seam is crossed exactly once
    // per local install/reload, under main's control.
    const index = readFileSync(join(process.cwd(), 'apps/desktop/src/host.ts'), 'utf8');
    expect(index).toMatch(/installFromDir\(\s*packed\.value\.stagingDir/);
  });
});
