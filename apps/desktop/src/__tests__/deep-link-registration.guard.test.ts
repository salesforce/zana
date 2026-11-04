import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const hostSource = strip(readFileSync(join(root, 'apps/desktop/src/deep-link-host.ts'), 'utf8'));
const mainSource = strip(readFileSync(join(root, 'apps/desktop/src/host.ts'), 'utf8'));
const contractSource = strip(readFileSync(join(root, 'packages/desktop-contract/src/deep-link.ts'), 'utf8'));

describe('deep link OS registration is unreachable under E2E', () => {
  it('registerDeepLinkScheme returns before any registration call when ZCC_E2E_HOME is set', () => {
    const fn = hostSource.slice(hostSource.indexOf('export function registerDeepLinkScheme'));
    const guard = fn.indexOf("if (input.env.ZCC_E2E_HOME) return 'skipped-e2e';");
    const firstRegister = fn.indexOf('setAsDefaultProtocolClient(');
    expect(guard).toBeGreaterThan(-1);
    expect(firstRegister).toBeGreaterThan(guard);
  });

  it('the channel never marks an E2E build registerable', () => {
    const e2eBranch = contractSource.slice(contractSource.indexOf('if (env.ZCC_E2E_HOME) {'), contractSource.indexOf('if (input.isPackaged)'));
    expect(e2eBranch).toContain('registerWithOs: false');
    expect(e2eBranch).not.toContain('registerWithOs: true');
  });

  it('the only OS registration call site in main is the guarded helper', () => {
    const calls = mainSource.match(/app\.setAsDefaultProtocolClient\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(mainSource).toMatch(/registerDeepLinkScheme\(\{/);
    expect(hostSource.match(/input\.setAsDefaultProtocolClient\(/g)).toHaveLength(2);
  });

  it('the E2E scheme override is only honoured behind ZCC_E2E_HOME', () => {
    expect(contractSource).toMatch(/if \(env\.ZCC_E2E_HOME\) \{[\s\S]*ZCC_E2E_DEEP_LINK_SCHEME/);
    expect(contractSource.split('ZCC_E2E_DEEP_LINK_SCHEME').length - 1).toBe(1);
    for (const text of [hostSource, mainSource]) expect(text).not.toContain('ZCC_E2E_DEEP_LINK_SCHEME');
  });

  it('subscribes to open-url and second-instance at module init, not in createWindow', () => {
    const createWindow = mainSource.slice(mainSource.indexOf('function createWindow('), mainSource.indexOf('function createWindow(') + 12000);
    expect(createWindow).not.toContain("'open-url'");
    expect(mainSource.match(/app\.on\('open-url'/g)).toHaveLength(1);
  });
});

describe('deep links stay main-validated', () => {
  it('the host only builds deliveries from parseAnyDeepLink results', () => {
    expect(hostSource).toContain('parseAnyDeepLink(');
    expect(hostSource).not.toMatch(/[^y]parseDeepLink\(/);
  });

  it('main sends validated plugin deliveries on onLink', () => {
    expect(mainSource).toContain('win.webContents.send(IPC.deepLinks.onLink, delivery)');
  });
});
