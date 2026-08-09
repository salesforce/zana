/**
 * Install-seam guard for the "install from a git repo" (Track A) feature.
 *
 * The security story of a git install rests on the SAME single-seam invariant as
 * a local install: an attacker-controlled repo's bytes are INERT until they cross
 * the one trusted install seam (`installFromDir` in extension-installer.ts), which
 * re-runs every manifest/id/api/reserved/containment gate. `installFromGit` must
 * therefore only ever clone + stage into an OS-tmp dir, never compute or write the
 * live install location, funnel through `installFromDir`, and ALWAYS remove its
 * temp dirs. This is a source-text scan (no execution): it fails if the git path
 * ever regresses to writing under the install root, skips the seam, or drops the
 * cleanup.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const mainRoot = join(__dirname, '..');

/** Strip comments + template-literal bodies so PROSE mentions of `.zcc`, the
 *  install root, etc. in error strings and doc comments don't trip the scan —
 *  we guard the LOGIC only. (See the local-extension seam guard for the rationale
 *  behind the backtick-body strip.) */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

describe('install-from-git install-seam guard', () => {
  const file = join(mainRoot, 'extension-installer.ts');
  const raw = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const code = stripComments(raw);

  it('extension-installer.ts exists and is scanned', () => {
    expect(existsSync(file)).toBe(true);
  });

  it('installFromGit clones + stages into OS-tmp only, never a home/install path', () => {
    // Isolate the installFromGit body so unrelated helpers (seedBundled, the
    // installRoot() accessor) don't pollute the scan.
    const start = code.indexOf('export async function installFromGit');
    expect(start).toBeGreaterThan(-1);
    const end = code.indexOf('\nexport ', start + 1);
    const body = end > -1 ? code.slice(start, end) : code.slice(start);

    // Temp dirs come from tmpdir() — never homedir()/installRoot()/`.zcc`.
    expect(body).toMatch(/tmpdir\s*\(/);
    expect(body, 'installFromGit must not compute the install root').not.toMatch(/installRoot\s*\(/);
    expect(body, 'installFromGit must not reference homedir').not.toMatch(/\bhomedir\b/);
    expect(body).not.toMatch(/\.zcc/);
    expect(body).not.toMatch(/ZCC_EXTENSIONS_DIR/);
  });

  it('funnels through the single trusted installFromDir seam', () => {
    const start = code.indexOf('export async function installFromGit');
    const end = code.indexOf('\nexport ', start + 1);
    const body = end > -1 ? code.slice(start, end) : code.slice(start);
    // The staged copy must reach installFromDir; the git path must not write the
    // install dir itself (no replaceDir call inside installFromGit).
    expect(body).toMatch(/installFromDir\s*\(/);
    expect(body).not.toMatch(/\breplaceDir\s*\(/);
  });

  it('always removes its temp + staging dirs in a finally', () => {
    const start = code.indexOf('export async function installFromGit');
    const end = code.indexOf('\nexport ', start + 1);
    const body = end > -1 ? code.slice(start, end) : code.slice(start);
    expect(body).toMatch(/finally\s*\{/);
    // Both the clone tmp and the staging dir are rm'd.
    expect((body.match(/rm\(\s*(tmp|staged)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('the checkout path is guarded by safeRef and never uses `--` with a ref', () => {
    const git = stripComments(readFileSync(join(mainRoot, 'git-clone.ts'), 'utf8'));
    // safeRef exists and is applied before any ref flows into argv.
    expect(git).toMatch(/function safeRef\b/);
    expect(git).toMatch(/safeRef\(/);
    // The detached checkout must NOT terminate options with `--` (that turns the
    // ref into a pathspec — the load-bearing bug safeRef exists to make moot).
    expect(git).not.toMatch(/checkout['"\s,]+.*'--'/);
    expect(git).not.toMatch(/'checkout'[^)]*'--'[^)]*ref/);
  });

  it('the live-install path is index.ts wiring installFromGit → markGit(fail-closed) → runDiskSync', () => {
    // Positive assertion: index.ts (the trusted orchestrator) crosses the seam and
    // records provenance fail-closed on the INITIAL install before the shared
    // install tail runs.
    const index = readFileSync(join(mainRoot, 'index.ts'), 'utf8');
    expect(index).toMatch(/installFromGit\(/);
    expect(index).toMatch(/markGit\(/);
    // A markGit failure on the FIRST install must abort (WRITE_FAILED) AND roll the
    // just-installed bytes back out (uninstallExtension) — never leave a git
    // extension with no origin badge (the consent warning depends on it). The
    // rollback logic sits between markGit and the WRITE_FAILED return, so the
    // window spans it. (The UPDATE path is deliberately best-effort — the id is
    // already tracked from the first install, so a failed sha refresh only leaves
    // stale metadata, not an un-provenanced extension — and is asserted separately.)
    expect(index).toMatch(/markGit[\s\S]{0,700}uninstallExtension[\s\S]{0,200}WRITE_FAILED/);
    // The update path refreshes provenance best-effort (no WRITE_FAILED abort): it
    // logs and still reconciles so the running child never lags the on-disk bytes.
    expect(index).toMatch(/reinstallFromGit[\s\S]*?markGit[\s\S]{0,400}runDiskSync/);
  });
});
