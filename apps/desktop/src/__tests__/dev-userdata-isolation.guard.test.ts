import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const bootstrap = readFileSync(join(process.cwd(), 'apps/desktop/src/bootstrap.ts'), 'utf8');
const host = readFileSync(join(process.cwd(), 'apps/desktop/src/host.ts'), 'utf8');

describe('unpackaged data-dir isolation', () => {
  it('pins Electron userData under ZCC_DATA_DIR unless E2E remapped home', () => {
    expect(bootstrap).toMatch(/const e2eHome = process\.env\.ZCC_E2E_HOME/);
    expect(bootstrap).toMatch(/if \(!e2eHome && dataDir && !app\.isPackaged\)/);
    expect(bootstrap).toMatch(/app\.setPath\('userData', join\(dataDir, 'electron-user-data'\)\)/);
  });

  it('binds control.sock under resolveZccDataDir', () => {
    expect(host).toMatch(/const controlDir = resolveZccDataDir\(process\.env, app\.getPath\('home'\)\)/);
    expect(host).toMatch(/socketPath: join\(controlDir, 'control\.sock'\)/);
  });
});
