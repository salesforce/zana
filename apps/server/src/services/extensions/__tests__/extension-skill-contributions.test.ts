import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * docs/extension-agent-capabilities-plan.md §5/§7 — extension-contributed
 * skills. `deploySkillsForExtension`/`removeSkillsForExtension`/
 * `syncExtensionSkills` deploy a manifest-declared skill file into
 * `~/.claude/skills/ext-<id>-<slug>/SKILL.md`, gated on `agent:contribute` +
 * enabled + consented, with Rule 2 path confinement against the extension's
 * OWN dir. `homedir()` is mocked to an isolated temp dir.
 */
const testHome = join(tmpdir(), `ext-skill-contrib-test-${process.pid}`);

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => join(tmpdir(), `ext-skill-contrib-test-${process.pid}`) };
});

// eslint-disable-next-line import/first
import {
  deploySkillsForExtension,
  removeSkillsForExtension,
  syncExtensionSkills,
  syncPluginSkills
} from '../../skills/skill-installer.js';

let extRoot: string;

function makeExtDir(id: string, files: Record<string, string> = { 'skills/foo.md': '# Foo skill\n' }): string {
  const dir = join(extRoot, id);
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content, 'utf-8');
  }
  return dir;
}

describe('extension skill contributions', () => {
  beforeEach(() => {
    rmSync(testHome, { recursive: true, force: true });
    extRoot = mkdtempSync(join(tmpdir(), 'cc-ext-skill-src-'));
  });
  afterEach(() => {
    rmSync(testHome, { recursive: true, force: true });
    rmSync(extRoot, { recursive: true, force: true });
  });

  it('deploys a well-formed skill from an enabled+consented extension declaring agent:contribute', async () => {
    const dir = makeExtDir('acme.skills');
    const results = await deploySkillsForExtension({
      id: 'acme.skills',
      path: dir,
      enabled: true,
      consented: true,
      manifest: { permissions: ['agent:contribute'], skills: [{ path: 'skills/foo.md', slug: 'foo' }] }
    });
    expect(results).toEqual([{ name: 'ext-acme.skills-foo', ok: true }]);
    const file = join(testHome, '.claude', 'skills', 'ext-acme.skills-foo', 'SKILL.md');
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf-8')).toBe('# Foo skill\n');
  });

  it('does nothing without agent:contribute, even if enabled + consented', async () => {
    const dir = makeExtDir('acme.noperm');
    const results = await deploySkillsForExtension({
      id: 'acme.noperm',
      path: dir,
      enabled: true,
      consented: true,
      manifest: { permissions: [], skills: [{ path: 'skills/foo.md' }] }
    });
    expect(results).toEqual([]);
    expect(existsSync(join(testHome, '.claude', 'skills'))).toBe(false);
  });

  it('does nothing when disabled or unconsented, even with agent:contribute declared', async () => {
    const dir = makeExtDir('acme.gated');
    const disabled = await deploySkillsForExtension({
      id: 'acme.gated',
      path: dir,
      enabled: false,
      consented: true,
      manifest: { permissions: ['agent:contribute'], skills: [{ path: 'skills/foo.md' }] }
    });
    const unconsented = await deploySkillsForExtension({
      id: 'acme.gated',
      path: dir,
      enabled: true,
      consented: false,
      manifest: { permissions: ['agent:contribute'], skills: [{ path: 'skills/foo.md' }] }
    });
    expect(disabled).toEqual([]);
    expect(unconsented).toEqual([]);
  });

  it('rejects a skill path that escapes the extension dir (Rule 2)', async () => {
    const dir = makeExtDir('acme.escape');
    const results = await deploySkillsForExtension({
      id: 'acme.escape',
      path: dir,
      enabled: true,
      consented: true,
      manifest: { permissions: ['agent:contribute'], skills: [{ path: '../../../etc/passwd', slug: 'evil' }] }
    });
    expect(results).toEqual([{ name: 'ext-acme.escape-evil', ok: false }]);
    expect(existsSync(join(testHome, '.claude', 'skills', 'ext-acme.escape-evil'))).toBe(false);
  });

  it('is idempotent — a second deploy of unchanged content still reports ok without rewriting', async () => {
    const dir = makeExtDir('acme.idem');
    const contributor = {
      id: 'acme.idem',
      path: dir,
      enabled: true,
      consented: true,
      manifest: { permissions: ['agent:contribute'], skills: [{ path: 'skills/foo.md', slug: 'foo' }] }
    };
    const first = await deploySkillsForExtension(contributor);
    const second = await deploySkillsForExtension(contributor);
    expect(first).toEqual([{ name: 'ext-acme.idem-foo', ok: true }]);
    expect(second).toEqual([{ name: 'ext-acme.idem-foo', ok: true }]);
    const dirEntries = readdirSync(join(testHome, '.claude', 'skills', 'ext-acme.idem-foo'));
    expect(dirEntries.filter((f) => f.includes('.tmp-'))).toEqual([]);
  });

  it('removeSkillsForExtension deletes every ext-<id>-* dir for that extension only', async () => {
    const dirA = makeExtDir('acme.a');
    const dirB = makeExtDir('acme.b');
    await deploySkillsForExtension({
      id: 'acme.a',
      path: dirA,
      enabled: true,
      consented: true,
      manifest: { permissions: ['agent:contribute'], skills: [{ path: 'skills/foo.md', slug: 'foo' }] }
    });
    await deploySkillsForExtension({
      id: 'acme.b',
      path: dirB,
      enabled: true,
      consented: true,
      manifest: { permissions: ['agent:contribute'], skills: [{ path: 'skills/foo.md', slug: 'foo' }] }
    });
    await removeSkillsForExtension('acme.a');
    expect(existsSync(join(testHome, '.claude', 'skills', 'ext-acme.a-foo'))).toBe(false);
    expect(existsSync(join(testHome, '.claude', 'skills', 'ext-acme.b-foo'))).toBe(true);
  });

  it('syncExtensionSkills prunes a slug that changed and deploys the new one', async () => {
    const dir = makeExtDir('acme.rename', {
      'skills/foo.md': '# Foo\n',
      'skills/bar.md': '# Bar\n'
    });
    await syncExtensionSkills([
      {
        id: 'acme.rename',
        path: dir,
        enabled: true,
        consented: true,
        manifest: { permissions: ['agent:contribute'], skills: [{ path: 'skills/foo.md', slug: 'foo' }] }
      }
    ]);
    expect(existsSync(join(testHome, '.claude', 'skills', 'ext-acme.rename-foo'))).toBe(true);

    // New version renames the slug from 'foo' to 'bar'.
    await syncExtensionSkills([
      {
        id: 'acme.rename',
        path: dir,
        enabled: true,
        consented: true,
        manifest: { permissions: ['agent:contribute'], skills: [{ path: 'skills/bar.md', slug: 'bar' }] }
      }
    ]);
    expect(existsSync(join(testHome, '.claude', 'skills', 'ext-acme.rename-foo'))).toBe(false);
    expect(existsSync(join(testHome, '.claude', 'skills', 'ext-acme.rename-bar'))).toBe(true);
  });

  it('syncExtensionSkills removes a previously-deployed skill once the extension is disabled', async () => {
    const dir = makeExtDir('acme.disable');
    const enabled = {
      id: 'acme.disable',
      path: dir,
      enabled: true,
      consented: true,
      manifest: { permissions: ['agent:contribute'], skills: [{ path: 'skills/foo.md', slug: 'foo' }] }
    };
    await syncExtensionSkills([enabled]);
    expect(existsSync(join(testHome, '.claude', 'skills', 'ext-acme.disable-foo'))).toBe(true);

    await syncExtensionSkills([{ ...enabled, enabled: false }]);
    expect(existsSync(join(testHome, '.claude', 'skills', 'ext-acme.disable-foo'))).toBe(false);
  });

  it('never throws on a malformed contributor and still deploys the well-formed ones', async () => {
    const dirGood = makeExtDir('acme.good');
    await expect(
      syncExtensionSkills([
        // @ts-expect-error deliberately malformed for the resilience assertion
        { id: 'acme.bad', path: '/nonexistent/path', enabled: true, consented: true, manifest: { permissions: ['agent:contribute'], skills: 'not-an-array' } },
        {
          id: 'acme.good',
          path: dirGood,
          enabled: true,
          consented: true,
          manifest: { permissions: ['agent:contribute'], skills: [{ path: 'skills/foo.md', slug: 'foo' }] }
        }
      ])
    ).resolves.not.toThrow();
    expect(existsSync(join(testHome, '.claude', 'skills', 'ext-acme.good-foo'))).toBe(true);
  });

  it('syncPluginSkills deploys SKILL.md from a skills root without agent:contribute', async () => {
    const dir = makeExtDir('docs', { 'skills/hello/SKILL.md': '# Hello plugin skill\n' });
    await syncPluginSkills([
      { id: 'docs', rootDir: dir, enabled: true, skillsRootPaths: ['skills'] }
    ]);
    const file = join(testHome, '.claude', 'skills', 'plugin-docs-hello', 'SKILL.md');
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf-8')).toBe('# Hello plugin skill\n');
  });

  it('syncPluginSkills prunes when the plugin is disabled', async () => {
    const dir = makeExtDir('docs-off', { 'skills/hello/SKILL.md': '# Hello\n' });
    await syncPluginSkills([
      { id: 'docs-off', rootDir: dir, enabled: true, skillsRootPaths: ['skills'] }
    ]);
    expect(existsSync(join(testHome, '.claude', 'skills', 'plugin-docs-off-hello'))).toBe(true);
    await syncPluginSkills([
      { id: 'docs-off', rootDir: dir, enabled: false, skillsRootPaths: ['skills'] }
    ]);
    expect(existsSync(join(testHome, '.claude', 'skills', 'plugin-docs-off-hello'))).toBe(false);
  });
});
