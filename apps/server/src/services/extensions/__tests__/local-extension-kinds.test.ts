/**
 * Track B (authoring) coverage: plugin starter KINDS + the share/pack loop.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EXTENSION_CREATOR_SKILL = join(process.cwd(), 'apps/server/src/plugins/builtin-skills/extension-creator/SKILL.md');

async function importLocalExt() {
  return await import('../local-extension.js');
}

describe('local-extension plugin kinds', () => {
  it('documents the plugin SDK loop in the bundled Creator skill', async () => {
    const skill = await readFile(EXTENSION_CREATOR_SKILL, 'utf-8');
    expect(skill).toContain('package.json');
    expect(skill).toContain('definePluginApp');
    expect(skill).toContain('install_local_extension');
    expect(skill).toContain('zcc plugin');
  });

  it('clampLocalKind allowlists the four kinds and defaults unknown → panel', async () => {
    const { clampLocalKind } = await importLocalExt();
    expect(clampLocalKind('panel')).toBe('panel');
    expect(clampLocalKind('main-panel')).toBe('main-panel');
    expect(clampLocalKind('mcp-consumer')).toBe('mcp-consumer');
    expect(clampLocalKind('agent-preset')).toBe('agent-preset');
    expect(clampLocalKind('evil')).toBe('panel');
    expect(clampLocalKind('')).toBe('panel');
    expect(clampLocalKind(undefined)).toBe('panel');
    expect(clampLocalKind(42)).toBe('panel');
  });
});

describe('scaffoldLocalExtension (per kind)', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'cc-scaffold-'));
  });
  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('scaffolds main-panel with a server factory + app slot', async () => {
    const { scaffoldLocalExtension } = await importLocalExt();
    const res = await scaffoldLocalExtension(workDir, {
      id: 'my-back-a1b2',
      name: 'My Backend',
      description: 'A backend tool',
      kind: 'main-panel'
    });
    expect(res.ok).toBe(true);
    const pkg = JSON.parse(await readFile(join(workDir, 'package.json'), 'utf-8'));
    expect(pkg.name).toBe('zcc-plugin-my-back-a1b2');
    expect(pkg.zcc.server).toBe('./server.ts');
    expect(pkg.zcc.app).toBe('./app.tsx');
    expect(existsSync(join(workDir, 'server.ts'))).toBe(true);
    expect(existsSync(join(workDir, 'app.js'))).toBe(true);
    expect(existsSync(join(workDir, 'extension.json'))).toBe(false);
  });

  it('scaffolds mcp-consumer with zcc.mcpServers', async () => {
    const { scaffoldLocalExtension } = await importLocalExt();
    const res = await scaffoldLocalExtension(workDir, {
      id: 'mcp-1',
      name: 'MCP',
      kind: 'mcp-consumer'
    });
    expect(res.ok).toBe(true);
    const pkg = JSON.parse(await readFile(join(workDir, 'package.json'), 'utf-8'));
    expect(pkg.zcc.mcpServers).toBeTruthy();
    expect(pkg.zcc.server).toBe('./server.ts');
  });

  it('scaffolds agent-preset without an app entry', async () => {
    const { scaffoldLocalExtension } = await importLocalExt();
    const res = await scaffoldLocalExtension(workDir, {
      id: 'coach-c3d4',
      name: 'Coach',
      kind: 'agent-preset'
    });
    expect(res.ok).toBe(true);
    const pkg = JSON.parse(await readFile(join(workDir, 'package.json'), 'utf-8'));
    expect(pkg.zcc.server).toBe('./server.ts');
    expect(pkg.zcc.app).toBeUndefined();
    expect(existsSync(join(workDir, 'app.js'))).toBe(false);
  });

  it('never clobbers a file the agent already edited', async () => {
    const { scaffoldLocalExtension } = await importLocalExt();
    await writeFile(join(workDir, 'app.js'), '// hand-edited\n', 'utf-8');
    await scaffoldLocalExtension(workDir, { id: 'x-0001', name: 'X', kind: 'panel' });
    expect(await readFile(join(workDir, 'app.js'), 'utf-8')).toBe('// hand-edited\n');
  });

  it('teaches every starter to use the plugin SDK loop', async () => {
    const { scaffoldLocalExtension, VALID_LOCAL_KINDS } = await importLocalExt();
    for (const kind of VALID_LOCAL_KINDS) {
      const dir = await mkdtemp(join(tmpdir(), `cc-kind-${kind}-`));
      try {
        await scaffoldLocalExtension(dir, { id: `k-${kind}`, name: kind, kind });
        const brief = await readFile(join(dir, 'CLAUDE.md'), 'utf-8');
        expect(brief, `${kind}/CLAUDE.md`).toContain('zcc plugin dev');
        expect(brief, `${kind}/CLAUDE.md`).toContain('definePluginApp');
        expect(brief, `${kind}/CLAUDE.md`).not.toContain('extension.json');
        expect(brief, `${kind}/CLAUDE.md`).not.toMatch(/activate\s*\(/);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });
});

describe('prepareShareDir', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'cc-share-'));
    await mkdir(join(workDir, 'dist'), { recursive: true });
    await writeFile(
      join(workDir, 'extension.json'),
      JSON.stringify({
        id: 'share-me',
        version: '1.0.0',
        title: 'Share Me',
        description: 'demo',
        icon: 'Puzzle',
        entry: { renderer: 'dist/renderer.js' },
        engines: { zccApi: '^1.0.0' }
      }),
      'utf-8'
    );
    await writeFile(join(workDir, 'dist', 'renderer.js'), '// x\n', 'utf-8');
    await writeFile(join(workDir, 'README.md'), '# source readme\n', 'utf-8');
    await writeFile(join(workDir, 'package.json'), '{}', 'utf-8');
  });
  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('assembles manifest + dist/ + a generated README, leaving clutter behind', async () => {
    const { prepareShareDir } = await importLocalExt();
    const res = await prepareShareDir(workDir);
    expect(res.ok).toBe(true);
    const share = join(workDir, 'share');
    expect(existsSync(join(share, 'extension.json'))).toBe(true);
    expect(existsSync(join(share, 'dist', 'renderer.js'))).toBe(true);
    expect(existsSync(join(share, 'README.md'))).toBe(true);
    expect(await readFile(join(share, 'README.md'), 'utf-8')).not.toContain('source readme');
    expect(existsSync(join(share, 'package.json'))).toBe(false);
  });

  it('is idempotent and never packs share/ into itself', async () => {
    const { prepareShareDir } = await importLocalExt();
    await prepareShareDir(workDir);
    const res = await prepareShareDir(workDir);
    expect(res.ok).toBe(true);
    const share = join(workDir, 'share');
    expect(existsSync(join(share, 'share'))).toBe(false);
    const entries = (await readdir(share)).sort();
    expect(entries).toEqual(['README.md', 'dist', 'extension.json']);
  });

  it('fails NO_MANIFEST for a dir without a plugin or extension manifest', async () => {
    const { prepareShareDir } = await importLocalExt();
    const empty = await mkdtemp(join(tmpdir(), 'cc-share-empty-'));
    try {
      const res = await prepareShareDir(empty);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('NO_MANIFEST');
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});
