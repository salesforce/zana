/**
 * Track B (authoring) coverage: the starter-template KINDS + the share/pack loop.
 *
 * - Every declared kind has a committed template dir with the files the trust
 *   ladder promises (guards drift between `LocalExtensionKind` and the templates).
 * - `clampLocalKind` is the Rule-1 allowlist: an unknown/renderer-supplied kind
 *   falls back to 'panel', never scaffolds something unexpected.
 * - `scaffoldLocalExtension` per kind lands the right entry files + token
 *   substitution, via the `ZCC_EXTENSION_TEMPLATE_DIR` override (authoritative).
 * - `prepareShareDir` is idempotent and never packs `share/` into itself.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
// The committed editable templates live at repo-root templates/extension-starter.
const TEMPLATE_ROOT = join(__dirname, '../../../templates/extension-starter');
const EXTENSION_CREATOR_SKILL = join(__dirname, '../../../resources/extension-creator-skill.md');

async function importLocalExt() {
  return await import('../local-extension.js');
}

describe('local-extension template kinds', () => {
  it('documents the host-owned picker contract in the bundled Creator skill', async () => {
    const skill = await readFile(EXTENSION_CREATOR_SKILL, 'utf-8');
    expect(skill).toContain('Controls — use host picklists, not native selects');
    expect(skill).toContain('host.quickPick');
    expect(skill).toContain('Never import core renderer internals');
  });

  it('clampLocalKind allowlists the four kinds and defaults unknown → panel', async () => {
    const { clampLocalKind } = await importLocalExt();
    expect(clampLocalKind('panel')).toBe('panel');
    expect(clampLocalKind('main-panel')).toBe('main-panel');
    expect(clampLocalKind('mcp-consumer')).toBe('mcp-consumer');
    expect(clampLocalKind('agent-preset')).toBe('agent-preset');
    // Rule 1: anything else clamps to the safest kind.
    expect(clampLocalKind('evil')).toBe('panel');
    expect(clampLocalKind('')).toBe('panel');
    expect(clampLocalKind(undefined)).toBe('panel');
    expect(clampLocalKind(42)).toBe('panel');
  });

  it('every kind has a committed template dir with a manifest + renderer', async () => {
    const { VALID_LOCAL_KINDS } = await importLocalExt();
    for (const kind of VALID_LOCAL_KINDS) {
      const dir = join(TEMPLATE_ROOT, kind);
      expect(existsSync(dir), `template dir for ${kind}`).toBe(true);
      expect(existsSync(join(dir, 'extension.json')), `${kind}/extension.json`).toBe(true);
      expect(existsSync(join(dir, 'dist', 'renderer.js')), `${kind}/dist/renderer.js`).toBe(true);
    }
  });

  it('backend kinds ship dist/main.mjs; agent-preset & panel do not require it', async () => {
    // main-panel + mcp-consumer declare entry.main → must ship the backend under
    // dist/ (packing copies manifest + dist/ only).
    for (const kind of ['main-panel', 'mcp-consumer']) {
      const manifest = JSON.parse(
        await readFile(join(TEMPLATE_ROOT, kind, 'extension.json'), 'utf-8')
      );
      expect(manifest.entry.main, `${kind} entry.main`).toBe('dist/main.mjs');
      expect(existsSync(join(TEMPLATE_ROOT, kind, 'dist', 'main.mjs')), `${kind}/dist/main.mjs`).toBe(
        true
      );
    }
    // agent-preset has no backend and carries an agentPreset block.
    const preset = JSON.parse(
      await readFile(join(TEMPLATE_ROOT, 'agent-preset', 'extension.json'), 'utf-8')
    );
    expect(preset.entry.main).toBeUndefined();
    expect(preset.agentPreset).toBeTruthy();
  });

  it('the two backend kinds declare their (only) permission; panel declares none', async () => {
    const perms = async (kind: string) =>
      JSON.parse(await readFile(join(TEMPLATE_ROOT, kind, 'extension.json'), 'utf-8')).permissions;
    expect(await perms('main-panel')).toEqual(['exec']);
    expect(await perms('mcp-consumer')).toEqual(['mcp']);
    expect(await perms('panel')).toEqual([]);
    expect(await perms('agent-preset')).toEqual([]);
  });

  it('no template carries a substitution token the scaffolder cannot replace', async () => {
    // A `__X__` token in a template that scaffoldLocalExtension does not know how
    // to substitute would ship verbatim into a scaffolded extension. Guard drift
    // between the committed templates and templateTokens by asserting every token
    // present in any template file is one of the four the scaffolder replaces.
    const { VALID_LOCAL_KINDS } = await importLocalExt();
    const KNOWN = new Set(['__EXT_ID__', '__EXT_TITLE__', '__EXT_DESCRIPTION__', '__EXT_API_MAJOR__']);
    const tokenRe = /__[A-Z0-9_]+__/g;
    for (const kind of VALID_LOCAL_KINDS) {
      const dir = join(TEMPLATE_ROOT, kind);
      const stack = [dir];
      while (stack.length) {
        const cur = stack.pop()!;
        for (const ent of await readdir(cur, { withFileTypes: true })) {
          const abs = join(cur, ent.name);
          if (ent.isDirectory()) {
            stack.push(abs);
            continue;
          }
          const text = await readFile(abs, 'utf-8');
          for (const tok of text.match(tokenRe) ?? []) {
            expect(KNOWN.has(tok), `${kind}/${ent.name} has unknown token ${tok}`).toBe(true);
          }
        }
      }
    }
  });

  it('teaches every starter to use host picklists instead of native selects', async () => {
    const { VALID_LOCAL_KINDS } = await importLocalExt();
    for (const kind of VALID_LOCAL_KINDS) {
      const brief = await readFile(join(TEMPLATE_ROOT, kind, 'CLAUDE.md'), 'utf-8');
      expect(brief, `${kind}/CLAUDE.md`).toContain('host.quickPick');
      expect(brief, `${kind}/CLAUDE.md`).toContain('native `select`');
    }
  });
});

describe('scaffoldLocalExtension (per kind, via template override)', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'cc-scaffold-'));
  });
  afterEach(async () => {
    delete process.env.ZCC_EXTENSION_TEMPLATE_DIR;
    await rm(workDir, { recursive: true, force: true });
  });

  it('scaffolds main-panel with a tokenized manifest + backend', async () => {
    const { scaffoldLocalExtension } = await importLocalExt();
    process.env.ZCC_EXTENSION_TEMPLATE_DIR = TEMPLATE_ROOT;
    const res = await scaffoldLocalExtension(workDir, {
      id: 'my-back-a1b2',
      name: 'My Backend',
      description: 'A backend tool',
      kind: 'main-panel'
    });
    expect(res.ok).toBe(true);
    const manifest = JSON.parse(await readFile(join(workDir, 'extension.json'), 'utf-8'));
    // Tokens substituted.
    expect(manifest.id).toBe('my-back-a1b2');
    expect(manifest.title).toBe('My Backend');
    expect(manifest.entry.main).toBe('dist/main.mjs');
    // Backend + renderer both scaffolded under dist/.
    expect(existsSync(join(workDir, 'dist', 'main.mjs'))).toBe(true);
    expect(existsSync(join(workDir, 'dist', 'renderer.js'))).toBe(true);
    // No unsubstituted tokens leaked into the manifest.
    const raw = await readFile(join(workDir, 'extension.json'), 'utf-8');
    expect(raw).not.toContain('__EXT_');
  });

  it('scaffolds agent-preset (no backend) with the agentPreset block', async () => {
    const { scaffoldLocalExtension } = await importLocalExt();
    process.env.ZCC_EXTENSION_TEMPLATE_DIR = TEMPLATE_ROOT;
    const res = await scaffoldLocalExtension(workDir, {
      id: 'coach-c3d4',
      name: 'Coach',
      kind: 'agent-preset'
    });
    expect(res.ok).toBe(true);
    const manifest = JSON.parse(await readFile(join(workDir, 'extension.json'), 'utf-8'));
    expect(manifest.agentPreset).toBeTruthy();
    expect(manifest.entry.main).toBeUndefined();
    expect(existsSync(join(workDir, 'dist', 'main.mjs'))).toBe(false);
  });

  it('never clobbers a file the agent already edited', async () => {
    const { scaffoldLocalExtension } = await importLocalExt();
    process.env.ZCC_EXTENSION_TEMPLATE_DIR = TEMPLATE_ROOT;
    await mkdir(join(workDir, 'dist'), { recursive: true });
    await writeFile(join(workDir, 'dist', 'renderer.js'), '// hand-edited\n', 'utf-8');
    await scaffoldLocalExtension(workDir, { id: 'x-0001', name: 'X', kind: 'panel' });
    expect(await readFile(join(workDir, 'dist', 'renderer.js'), 'utf-8')).toBe('// hand-edited\n');
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
    // Source clutter that must NOT ship.
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
    // The generated README is NOT the source README (curated allowlist).
    expect(await readFile(join(share, 'README.md'), 'utf-8')).not.toContain('source readme');
    // package.json is source clutter — never copied.
    expect(existsSync(join(share, 'package.json'))).toBe(false);
  });

  it('is idempotent and never packs share/ into itself', async () => {
    const { prepareShareDir } = await importLocalExt();
    await prepareShareDir(workDir);
    // A second run rebuilds cleanly — no nested share/ appears.
    const res = await prepareShareDir(workDir);
    expect(res.ok).toBe(true);
    const share = join(workDir, 'share');
    expect(existsSync(join(share, 'share'))).toBe(false);
    // Top-level share/ holds only the curated set.
    const entries = (await readdir(share)).sort();
    expect(entries).toEqual(['README.md', 'dist', 'extension.json']);
  });

  it('fails NO_MANIFEST for a dir without extension.json', async () => {
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
