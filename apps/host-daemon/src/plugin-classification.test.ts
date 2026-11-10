import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  classifyPlugin, parseInstalledPlugins, parseRemoteInventoryA, parseRemoteInventoryB, pluginNameOf,
  remoteInventoryScriptA, remoteInventoryScriptB, scanLocalSkillInventory, scanRemoteSkillInventory,
  SkillInventoryUnavailableError
} from './plugin-classification.js';

const remote = { host: 'h' } as never;

describe('classify / parse', () => {
  it('classifies', () => {
    expect(classifyPlugin(undefined)).toBe('mixed');
    expect(classifyPlugin({})).toBe('skills-only');
    for (const k of ['hooks', 'mcp', 'agents', 'lsp', 'manifest'] as const) expect(classifyPlugin({ [k]: true })).toBe('mixed');
  });
  it('pluginNameOf', () => {
    expect(pluginNameOf('a@m')).toBe('a');
    expect(pluginNameOf('a')).toBe('a');
  });
  it('parseInstalledPlugins handles v1, v2, malformed', () => {
    expect(parseInstalledPlugins('nope')).toEqual([]);
    expect(parseInstalledPlugins('{"plugins":[]}')).toEqual([]);
    expect(parseInstalledPlugins('{}')).toEqual([]);
    const v = parseInstalledPlugins(JSON.stringify({ plugins: {
      'a@m': { installPath: '/x/a' }, 'b@m': [{ installPath: '/x/b' }], 'bad id!': { installPath: '/x' },
      'c@m': { installPath: 'rel' }, 'd@m': {}
    } }));
    expect(v).toEqual([{ id: 'a@m', installPath: '/x/a' }, { id: 'b@m', installPath: '/x/b' }]);
  });
});

describe('scanLocalSkillInventory', () => {
  it('scans user, project, and plugins (async)', async () => {
    const home = mkdtempSync(join(tmpdir(), 'inv-'));
    const cwd = mkdtempSync(join(tmpdir(), 'cwd-'));
    mkdirSync(join(home, '.claude/skills/u1'), { recursive: true });
    mkdirSync(join(cwd, '.claude/skills/p1'), { recursive: true });
    mkdirSync(join(home, '.claude/commands'), { recursive: true });
    writeFileSync(join(home, '.claude/commands/uc.md'), '');
    writeFileSync(join(home, '.claude/commands/notes.txt'), '');
    mkdirSync(join(cwd, '.claude/commands'), { recursive: true });
    writeFileSync(join(cwd, '.claude/commands/pc.md'), '');
    const so = join(home, 'pl/so'); const mx = join(home, 'pl/mx'); const mf = join(home, 'pl/mf');
    mkdirSync(join(so, 'skills/s1'), { recursive: true });
    mkdirSync(join(so, 'commands'), { recursive: true });
    writeFileSync(join(so, 'commands/cmd.md'), '');
    mkdirSync(join(mx, 'skills/s2'), { recursive: true });
    mkdirSync(join(mx, 'hooks'), { recursive: true });
    mkdirSync(join(mf, '.claude-plugin'), { recursive: true });
    writeFileSync(join(mf, '.claude-plugin/plugin.json'), '{"mcpServers":{}}');
    mkdirSync(join(home, '.claude/plugins'), { recursive: true });
    writeFileSync(join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ plugins: {
      'so@m': { installPath: so }, 'mx@m': { installPath: mx }, 'mf@m': { installPath: mf }
    } }));
    const inv = await scanLocalSkillInventory({ home, cwd });
    expect(inv.userSkills).toEqual(['p1', 'pc', 'u1', 'uc']);
    const by = Object.fromEntries(inv.plugins.map((p) => [p.id, p]));
    expect(by['so@m']).toMatchObject({ kind: 'skills-only', skills: ['cmd', 's1'] });
    expect(by['mx@m']?.kind).toBe('mixed');
    expect(by['mf@m']?.kind).toBe('mixed');
  });
  it('empty home yields empty inventory (nothing installed is not unavailable)', async () => {
    const home = mkdtempSync(join(tmpdir(), 'inv-'));
    expect(await scanLocalSkillInventory({ home })).toEqual({ userSkills: [], plugins: [] });
  });
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('unreadable skills dir rejects as unavailable', async () => {
    const home = mkdtempSync(join(tmpdir(), 'inv-'));
    const dir = join(home, '.claude/skills');
    mkdirSync(join(dir, 'u1'), { recursive: true });
    chmodSync(dir, 0o000);
    try {
      await expect(scanLocalSkillInventory({ home })).rejects.toBeInstanceOf(SkillInventoryUnavailableError);
      await expect(scanLocalSkillInventory({ home })).rejects.toThrow(/cannot read .*EACCES/);
    } finally { chmodSync(dir, 0o700); }
  });
  it('unreadable installed_plugins.json (a directory) rejects as unavailable', async () => {
    const home = mkdtempSync(join(tmpdir(), 'inv-'));
    mkdirSync(join(home, '.claude/plugins/installed_plugins.json'), { recursive: true });
    await expect(scanLocalSkillInventory({ home })).rejects.toThrow(/installed_plugins\.json/);
  });
  it('entry cap trips -> unavailable', async () => {
    const home = mkdtempSync(join(tmpdir(), 'inv-'));
    for (let i = 0; i < 5; i++) mkdirSync(join(home, `.claude/skills/s${i}`), { recursive: true });
    await expect(scanLocalSkillInventory({ home, maxEntries: 3 })).rejects.toThrow(/exceeds 3 entries/);
    expect((await scanLocalSkillInventory({ home, maxEntries: 5 })).userSkills).toHaveLength(5);
  });
  it('plugin count and per-plugin entries count toward the cap', async () => {
    const home = mkdtempSync(join(tmpdir(), 'inv-'));
    const pl = join(home, 'pl');
    for (let i = 0; i < 4; i++) mkdirSync(join(pl, `skills/k${i}`), { recursive: true });
    mkdirSync(join(home, '.claude/plugins'), { recursive: true });
    writeFileSync(join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ plugins: { 'a@m': { installPath: pl } } }));
    await expect(scanLocalSkillInventory({ home, maxEntries: 3 })).rejects.toThrow(/exceeds/);
  });
  it('timeout trips -> unavailable', async () => {
    const home = mkdtempSync(join(tmpdir(), 'inv-'));
    mkdirSync(join(home, '.claude/skills/a'), { recursive: true });
    vi.useFakeTimers();
    try {
      const pending = scanLocalSkillInventory({ home, timeoutMs: 100 });
      const assertion = expect(pending).rejects.toThrow(/timed out/);
      vi.advanceTimersByTime(101); // fires before any fs callback can complete
      await assertion;
    } finally { vi.useRealTimers(); }
  });
  it('does not leak timers on success', async () => {
    const spy = vi.spyOn(globalThis, 'clearTimeout');
    await scanLocalSkillInventory({ home: mkdtempSync(join(tmpdir(), 'inv-')) });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('remote', () => {
  it('builds scripts', () => {
    expect(remoteInventoryScriptA()).toContain('"$HOME"/.claude/commands/*.md');
    expect(remoteInventoryScriptA()).not.toContain('/.claude/skills/*/; do [ -d "$d" ] && printf \'U\\t%s\\n\' "$(basename "$d")"; done; for c in \'');
    expect(remoteInventoryScriptA('/w')).toContain("'/w'/.claude/skills");
    expect(remoteInventoryScriptA('/w')).toContain("'/w'/.claude/commands");
    expect(remoteInventoryScriptB(['/h/.claude/plugins/a'])).toContain('printf \'E\\n\'');
  });
  it('parses A', () => {
    const out = parseRemoteInventoryA(`U\tx\nU\tbad name\nJ\n{"plugins":{"a@m":{"installPath":"/p/a"}}}`);
    expect(out.userSkills).toEqual(['x']);
    expect(out.installed).toEqual([{ id: 'a@m', installPath: '/p/a' }]);
    expect(parseRemoteInventoryA('U\ty')).toEqual({ userSkills: ['y'], installed: [] });
  });
  it('parses B incl. truncated and missing records', () => {
    const installed = [{ id: 'a@m', installPath: '/p/a' }, { id: 'b@m', installPath: '/p/b' }, { id: 'c@m', installPath: '/p/c' }, { id: 'd@m', installPath: '/p/d' }];
    const out = parseRemoteInventoryB('junk\nP\t/p/a\nS\ts1\nE\nP\t/p/b\nS\ts2\nX\nE\nP\t/p/c\nS\ts3\n', installed);
    expect(out.map((p) => [p.id, p.kind, p.skills])).toEqual([
      ['a@m', 'skills-only', ['s1']], ['b@m', 'mixed', ['s2']], ['c@m', 'mixed', ['s3']], ['d@m', 'mixed', []]
    ]);
  });
  it('scanRemote: ok, failure, no plugins, B failure', async () => {
    const A = `U\tu\nJ\n{"plugins":{"a@m":{"installPath":"/p/a"}}}`;
    const seq = (...r: unknown[]) => { let i = 0; return (async () => r[i++]) as never; };
    expect(await scanRemoteSkillInventory(remote, '/w', seq({ ok: false }))).toBeUndefined();
    expect(await scanRemoteSkillInventory(remote, undefined, seq({ ok: true, code: 1, stdout: '' }))).toBeUndefined();
    expect(await scanRemoteSkillInventory(remote, undefined, seq({ ok: true, code: 0, stdout: 'U\tu\nJ\n' }))).toEqual({ userSkills: ['u'], plugins: [] });
    const good = await scanRemoteSkillInventory(remote, undefined, seq({ ok: true, code: 0, stdout: A }, { ok: true, code: 0, stdout: 'P\t/p/a\nS\ts\nE\n' }));
    expect(good?.plugins[0]).toMatchObject({ kind: 'skills-only', skills: ['s'] });
    const bad = await scanRemoteSkillInventory(remote, undefined, seq({ ok: true, code: 0, stdout: A }, { ok: false }));
    expect(bad?.plugins[0]).toMatchObject({ kind: 'mixed', skills: [] });
    const noOut = await scanRemoteSkillInventory(remote, undefined, seq({ ok: true, code: 0 }));
    expect(noOut).toEqual({ userSkills: [], plugins: [] });
  });
});
