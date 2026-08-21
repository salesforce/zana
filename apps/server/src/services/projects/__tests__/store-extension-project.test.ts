import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * `store.ensureExtensionProject` — the dedicated per-extension project the
 * "create your own extension" flow spawns. It must (a) root the project at the
 * extension's SOURCE working dir, (b) group it under the "Extensions" category,
 * (c) prefix the display name, and (d) be idempotent by path — reusing (and
 * healing) an existing row rather than duplicating it.
 *
 * electron's `app.getPath('home')` is mocked to a temp dir so the real store
 * reads/writes an isolated `~/.zcc`.
 */
const testHome = join(tmpdir(), `store-ext-proj-test-${process.pid}`);
// The factory is hoisted above the `const testHome` init, so compute the path
// inside it (same value, no TDZ) rather than closing over the outer binding.
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'home') return join(tmpdir(), `store-ext-proj-test-${process.pid}`);
      throw new Error(`Unexpected getPath('${name}')`);
    }
  },
  shell: { openPath: vi.fn() }
}));

// eslint-disable-next-line import/first
import { store, EXTENSION_PROJECT_CATEGORY } from '../store.js';

describe('store.ensureExtensionProject', () => {
  let workDir: string;
  beforeEach(() => {
    rmSync(testHome, { recursive: true, force: true });
    mkdirSync(testHome, { recursive: true });
    // A stand-in for the scaffolded extension working dir (must exist —
    // addProject stats it).
    workDir = join(testHome, 'zcc-workspace', 'extensions', 'my-tool-abcd');
    mkdirSync(workDir, { recursive: true });
  });
  afterEach(() => {
    rmSync(testHome, { recursive: true, force: true });
  });

  it('roots the project at the working dir, categorized + name-prefixed', () => {
    const p = store.ensureExtensionProject(workDir, 'My Tool');
    expect(p.path).toBe(workDir);
    expect(p.category).toBe(EXTENSION_PROJECT_CATEGORY);
    expect(p.name).toBe('Ext: My Tool');
    // Persisted.
    const found = store.listProjects().find((x) => x.id === p.id);
    expect(found?.category).toBe(EXTENSION_PROJECT_CATEGORY);
  });

  it('is idempotent by path — a second call reuses the same row', () => {
    const a = store.ensureExtensionProject(workDir, 'My Tool');
    const b = store.ensureExtensionProject(workDir, 'My Tool');
    expect(b.id).toBe(a.id);
    expect(store.listProjects().filter((x) => x.path === workDir)).toHaveLength(1);
  });

  it('heals a plain project (added earlier without a category) in place', () => {
    // Simulate a pre-existing plain row at the same path.
    const plain = store.addProject(workDir);
    expect(plain.category).toBeUndefined();

    const healed = store.ensureExtensionProject(workDir, 'My Tool');
    expect(healed.id).toBe(plain.id); // same row, not a duplicate
    expect(healed.category).toBe(EXTENSION_PROJECT_CATEGORY);
    expect(healed.name).toBe('Ext: My Tool');
    expect(store.listProjects().filter((x) => x.path === workDir)).toHaveLength(1);
  });
});

describe('store.addProject — extension-source auto-classification', () => {
  let workDir: string;
  const writeManifest = (dir: string, obj: unknown) =>
    writeFileSync(join(dir, 'extension.json'), JSON.stringify(obj));
  beforeEach(() => {
    rmSync(testHome, { recursive: true, force: true });
    mkdirSync(testHome, { recursive: true });
    workDir = join(testHome, 'zcc-workspace', 'extensions', 'my-tool-abcd');
    mkdirSync(workDir, { recursive: true });
  });
  afterEach(() => {
    rmSync(testHome, { recursive: true, force: true });
  });

  it('classifies a directly-created extension source as an Extension', () => {
    // A valid manifest whose id matches the folder name — the SDK contract.
    writeManifest(workDir, {
      id: 'my-tool-abcd',
      title: 'My Tool',
      icon: 'Puzzle',
      engines: { zccApi: '^1.0.0' },
      entry: { renderer: 'dist/renderer.js' }
    });
    const p = store.addProject(workDir);
    expect(p.category).toBe(EXTENSION_PROJECT_CATEGORY);
    expect(p.name).toBe('Ext: My Tool');
  });

  it('leaves a plain directory (no manifest) as a plain project', () => {
    const p = store.addProject(workDir);
    expect(p.category).toBeUndefined();
    expect(p.name).toBe('my-tool-abcd');
  });

  it('ignores a manifest whose id does not match the folder name', () => {
    writeManifest(workDir, {
      id: 'some-other-id',
      title: 'My Tool',
      icon: 'Puzzle',
      engines: { zccApi: '^1.0.0' },
      entry: { renderer: 'dist/renderer.js' }
    });
    const p = store.addProject(workDir);
    expect(p.category).toBeUndefined();
  });

  it('heals a plain row when the manifest appears later (re-add)', () => {
    const plain = store.addProject(workDir);
    expect(plain.category).toBeUndefined();
    writeManifest(workDir, {
      id: 'my-tool-abcd',
      title: 'My Tool',
      icon: 'Puzzle',
      engines: { zccApi: '^1.0.0' },
      entry: { renderer: 'dist/renderer.js' }
    });
    const healed = store.addProject(workDir);
    expect(healed.id).toBe(plain.id);
    expect(healed.category).toBe(EXTENSION_PROJECT_CATEGORY);
    expect(healed.name).toBe('Ext: My Tool');
    expect(store.listProjects().filter((x) => x.path === workDir)).toHaveLength(1);
  });
});
