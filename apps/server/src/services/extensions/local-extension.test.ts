import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  mintLocalId,
  workingDirFor,
  scaffoldLocalExtension,
  packLocalExtension,
  readWorkingDirId
} from './local-extension.js';

/**
 * Pure/main-side mechanics of the "create your own extension" feature: mint a
 * containment-clean unique id, scaffold a starter template without clobbering,
 * and pack ONLY the installable bytes into a staging dir. The module is
 * electron-free, so this is a plain unit test.
 */
const VALID_ID = /^[a-z0-9][a-z0-9._-]*$/i;

let work: string;
beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'cc-local-ext-'));
});
afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

describe('mintLocalId', () => {
  it('produces a VALID_ID slug + 4-hex suffix from a human name', () => {
    const id = mintLocalId({ name: 'My Cool Tool', taken: new Set() });
    expect(id).toMatch(VALID_ID);
    expect(id).toMatch(/^my-cool-tool-[0-9a-f]{4}$/);
  });

  it('falls back to the "ext" stem for empty/garbage names', () => {
    expect(mintLocalId({ name: '', taken: new Set() })).toMatch(/^ext-[0-9a-f]{4}$/);
    expect(mintLocalId({ name: '!!!', taken: new Set() })).toMatch(/^ext-[0-9a-f]{4}$/);
    // Leading non-alphanumerics are stripped so the id starts alphanumeric.
    expect(mintLocalId({ name: '   ---trim me', taken: new Set() })).toMatch(VALID_ID);
  });

  it('strips diacritics and clamps the stem to 24 chars', () => {
    const id = mintLocalId({ name: 'Café ' + 'x'.repeat(40), taken: new Set() });
    const stem = id.replace(/-[0-9a-f]{4}$/, '');
    expect(stem.length).toBeLessThanOrEqual(24);
    expect(id).toMatch(VALID_ID);
  });

  it('never returns an id already in `taken`', () => {
    // Force many collisions: reserve every possible mint for the stem for a few
    // rounds is impractical, so instead assert over many draws that none collide.
    const taken = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const id = mintLocalId({ name: 'dup', taken });
      expect(taken.has(id)).toBe(false);
      taken.add(id);
    }
  });
});

describe('workingDirFor', () => {
  it('maps an id under <scratchRoot>/extensions/<id>', () => {
    expect(workingDirFor('/home/u/zcc-workspace', 'foo-abcd')).toBe(
      join('/home/u/zcc-workspace', 'extensions', 'foo-abcd')
    );
  });
});

describe('scaffoldLocalExtension', () => {
  it('writes a manifest + renderer + README with NO declared permissions', async () => {
    const res = await scaffoldLocalExtension(work, {
      id: 'foo-abcd',
      name: 'Foo Tool',
      description: 'does foo',
      kind: 'panel'
    });
    expect(res.ok).toBe(true);

    const manifest = JSON.parse(await readFile(join(work, 'extension.json'), 'utf-8'));
    expect(manifest.id).toBe('foo-abcd');
    expect(manifest.title).toBe('Foo Tool');
    expect(manifest.permissions).toEqual([]); // consent-clean until user adds one
    expect(manifest.entry.renderer).toBe('dist/renderer.js');
    expect(manifest.engines.zccApi).toMatch(/^\^\d+\.0\.0$/);

    expect(existsSync(join(work, 'dist', 'renderer.js'))).toBe(true);
    expect(existsSync(join(work, 'README.md'))).toBe(true);
    const renderer = await readFile(join(work, 'dist', 'renderer.js'), 'utf-8');
    expect(renderer).toContain('activate({ React, host })');

    // The "template" file the Creator agent auto-loads as project instructions.
    expect(existsSync(join(work, 'CLAUDE.md'))).toBe(true);
    const claude = await readFile(join(work, 'CLAUDE.md'), 'utf-8');
    expect(claude).toContain('Extension Creator');
    expect(claude).toContain('Reload from source'); // ship-changes loop
    expect(claude).toContain('extension-creator'); // points at the deeper skill
    expect(claude).toContain(manifest.id); // names this extension's id
  });

  it('never clobbers a file the agent has since edited', async () => {
    await mkdir(join(work, 'dist'), { recursive: true });
    await writeFile(join(work, 'dist', 'renderer.js'), '// user edits here', 'utf-8');

    const res = await scaffoldLocalExtension(work, {
      id: 'foo-abcd',
      name: 'Foo',
      kind: 'panel'
    });
    expect(res.ok).toBe(true);
    // Existing renderer preserved verbatim.
    expect(await readFile(join(work, 'dist', 'renderer.js'), 'utf-8')).toBe('// user edits here');
  });
});

describe('packLocalExtension', () => {
  it('copies ONLY the manifest + dist/, leaving source clutter behind', async () => {
    await scaffoldLocalExtension(work, { id: 'foo-abcd', name: 'Foo', kind: 'panel' });
    // Drop clutter (and a would-be secret) into the working dir.
    await writeFile(join(work, 'README.md'), '# readme', 'utf-8'); // already there; keep
    await writeFile(join(work, '.env'), 'SECRET=shhh', 'utf-8');
    await mkdir(join(work, 'node_modules', 'left'), { recursive: true });
    await writeFile(join(work, 'node_modules', 'left', 'index.js'), 'x', 'utf-8');
    await writeFile(join(work, 'package.json'), '{}', 'utf-8');

    const res = await packLocalExtension(work);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const staging = res.value.stagingDir;
    try {
      const entries = (await readdir(staging)).sort();
      expect(entries).toEqual(['dist', 'extension.json']);
      // The secret + clutter never crossed into staging.
      expect(existsSync(join(staging, '.env'))).toBe(false);
      expect(existsSync(join(staging, 'node_modules'))).toBe(false);
      expect(existsSync(join(staging, 'package.json'))).toBe(false);
      expect(existsSync(join(staging, 'dist', 'renderer.js'))).toBe(true);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  });

  it('fails closed when there is no manifest (no id-less husk installs)', async () => {
    const res = await packLocalExtension(work); // empty dir
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('NO_MANIFEST');
  });
});

describe('readWorkingDirId', () => {
  it('returns the manifest id, or null on a missing/garbage manifest', async () => {
    await scaffoldLocalExtension(work, { id: 'foo-abcd', name: 'Foo', kind: 'panel' });
    expect(await readWorkingDirId(work)).toBe('foo-abcd');

    const empty = await mkdtemp(join(tmpdir(), 'cc-local-empty-'));
    try {
      expect(await readWorkingDirId(empty)).toBeNull();
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});
