import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  linuxCiElectronArgs,
  linuxCiElectronEnv,
} from '../../../../e2e/fixtures/linux-electron-launch.js';

const fixture = readFileSync(join(process.cwd(), 'e2e/fixtures/app.ts'), 'utf8');
const workflow = readFileSync(join(process.cwd(), '.github/workflows/release.yml'), 'utf8');

describe('linux CI Electron launch', () => {
  it('emits sandbox + X11 ozone flags only on linux', () => {
    expect(linuxCiElectronArgs('linux')).toEqual([
      '--no-sandbox',
      '--disable-gpu',
      '--ozone-platform=x11',
    ]);
    expect(linuxCiElectronArgs('darwin')).toEqual([]);
    expect(linuxCiElectronArgs('win32')).toEqual([]);
  });

  it('pins ozone + sandbox env only on linux', () => {
    expect(linuxCiElectronEnv('linux')).toEqual({
      ELECTRON_OZONE_PLATFORM_HINT: 'x11',
      ELECTRON_DISABLE_SANDBOX: '1',
    });
    expect(linuxCiElectronEnv('darwin')).toEqual({});
  });

  it('launchApp uses the repo Electron binary and linux CI flags', () => {
    expect(fixture).toContain('executablePath: projectElectronBinary()');
    expect(fixture).toContain('linuxCiElectronArgs()');
    expect(fixture).toContain('linuxCiElectronEnv()');
    expect(fixture).toMatch(/createRequire\(import\.meta\.url\)\('electron'\)/);
  });

  it('release smoke relaxes Ubuntu 24.04 AppArmor userns before xvfb', () => {
    expect(workflow).toContain('kernel.apparmor_restrict_unprivileged_userns=0');
    const sysctlAt = workflow.indexOf('kernel.apparmor_restrict_unprivileged_userns=0');
    const smokeAt = workflow.indexOf('xvfb-run -a pnpm run test:smoke:only');
    expect(sysctlAt).toBeGreaterThan(0);
    expect(smokeAt).toBeGreaterThan(sysctlAt);
  });
});
