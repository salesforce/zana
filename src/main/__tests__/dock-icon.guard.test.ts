/**
 * Dock-icon guard — proves the macOS app ALWAYS claims a Dock icon, independent
 * of whatever classification LaunchServices may have cached for the bundle id.
 *
 * Why this needs a guard rather than a behavioural test: the Dock claim is a
 * boot-time side effect on Electron's `app` singleton (`setActivationPolicy` +
 * `dock.show`), which can't be exercised without a full Electron main process.
 * So — like `core-extension-separation.guard.test.ts` and
 * `local-extension-install-seam.guard.test.ts` — this is a B4 source-text scan:
 * no execution, no mocking. It asserts the load-bearing source shape stays intact.
 *
 * The Dock icon is guaranteed by two cooperating facts, each guarded below:
 *
 *   (a) The bundle ships NO `LSUIElement` key. `LSUIElement`/`accessory` would
 *       launch the app menu-bar-only (no Dock icon). electron-builder.yml's
 *       `mac.extendInfo` must not introduce it.
 *
 *   (b) Boot FORCES `app.setActivationPolicy('regular')` + `app.dock.show()` on
 *       darwin, before the first window opens. This is belt-and-suspenders: even
 *       if LaunchServices cached a stale `accessory` classification for our
 *       bundle id (common across local dev builds sharing one bundle id), forcing
 *       the policy at boot makes Dock presence independent of the LS cache.
 *
 * A regression here (someone adds `LSUIElement`, or flips the boot policy to
 * `'accessory'`, or drops the `dock.show()` call) would silently ship a build
 * that launches with no Dock icon on some machines — exactly the bug the boot
 * block was written to defend against.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..', '..', '..');
const indexSrc = readFileSync(join(repoRoot, 'src', 'main', 'index.ts'), 'utf8');
const builderYml = readFileSync(join(repoRoot, 'electron-builder.yml'), 'utf8');

describe('macOS Dock-icon guarantee', () => {
  it('boot forces the regular (Dock-present) activation policy on darwin', () => {
    expect(indexSrc).toMatch(/setActivationPolicy\(\s*['"]regular['"]\s*\)/);
  });

  it('never sets the accessory (menu-bar-only, no-Dock) policy anywhere in main', () => {
    expect(indexSrc).not.toMatch(/setActivationPolicy\(\s*['"]accessory['"]\s*\)/);
  });

  it('explicitly shows the Dock at boot', () => {
    expect(indexSrc).toMatch(/app\.dock\?\.show\(\)/);
  });

  it('the Dock claim is gated on darwin (no-op on other platforms)', () => {
    // The claim must be darwin-gated so it only runs on macOS — the platform
    // where the Dock/LSUIElement concept exists. It's expressed as an
    // early-return guard (`if (process.platform !== 'darwin') return;`) at the
    // top of `claimDock()`, immediately before the `setActivationPolicy` call.
    const claim = /process\.platform !== 'darwin'[\s\S]{0,200}?setActivationPolicy\(\s*'regular'\s*\)/;
    expect(indexSrc).toMatch(claim);
  });

  it('the packaged bundle declares no LSUIElement key (would hide the Dock icon)', () => {
    // `LSUIElement: true` in mac.extendInfo (or anywhere in the build config)
    // would launch the app as a menu-bar accessory with no Dock icon — the exact
    // classification the boot-time policy override defends against. Ship none.
    expect(builderYml).not.toMatch(/LSUIElement/);
  });

  it('the build config points mac.icon at the shipped icon file', () => {
    // The Dock icon is always claimed; this keeps it the BRANDED icon rather than
    // Electron's default (setIcon in index.ts resolves the same file at runtime).
    expect(builderYml).toMatch(/icon:\s*resources\/icon\.icns/);
  });
});
