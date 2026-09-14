import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ensureNodePtySpawnHelperExecutable,
  nodePtyPackageRoot,
  nodePtySpawnHelperPath,
  probeNodePtyInElectronChild
} from './ensure-node-pty-helper.mjs';

const repoRoot = dirname(fileURLToPath(new URL('.', import.meta.url)));

describe('ensure-node-pty-helper', () => {
  it('resolves the workspace node-pty install', () => {
    expect(nodePtyPackageRoot()).toContain('node-pty');
    if (process.platform !== 'win32') {
      expect(nodePtySpawnHelperPath()).toContain('spawn-helper');
    }
  });

  it('makes the Unix spawn-helper executable when present', () => {
    if (process.platform === 'win32') return;
    if (!existsSync(nodePtySpawnHelperPath())) return;
    expect(ensureNodePtySpawnHelperExecutable()).toBe(true);
  });

  it('probes node-pty in an Electron child without opening a window', () => {
    expect(probeNodePtyInElectronChild()).toEqual({ ok: true });
  });

  it('never dlopens node-pty in the ensure process', () => {
    const src = readFileSync(join(repoRoot, 'scripts/ensure-node-pty-helper.mjs'), 'utf8');
    expect(src).toMatch(/const loaded = probeNodePtyInElectronChild\(\);/);
    expect(src).toMatch(/rebuildNodePtyForElectron\(\);/);
    expect(src).toMatch(/const retry = probeNodePtyInElectronChild\(\);/);
    expect(src).not.toMatch(/ensureNodePtyForElectron[\s\S]*require\(['"]node-pty['"]\)/);
  });

  it('skips electron-rebuild -f when Electron can already load node-pty', () => {
    const src = readFileSync(join(repoRoot, 'scripts/ensure-node-pty-helper.mjs'), 'utf8');
    expect(src).toMatch(/if \(loaded\.ok\) \{\s*process\.stderr\.write\('\[ensure-node-pty\] Electron can already load node-pty; skip rebuild\\n'\);/);
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.rebuild).toBe(
      'node scripts/ensure-node-pty-helper.mjs --electron && node scripts/ensure-better-sqlite3.mjs'
    );
    expect(pkg.scripts['rebuild:electron']).toBe(
      'node scripts/ensure-node-pty-helper.mjs --electron && node scripts/ensure-better-sqlite3.mjs --electron'
    );
    expect(pkg.scripts.predev).toContain('ensure-node-pty-helper.mjs');
    expect(pkg.scripts.predev).not.toContain('ensure-node-pty-helper.mjs --electron');
  });
});
