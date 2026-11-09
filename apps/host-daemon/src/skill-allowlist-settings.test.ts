import { describe, expect, it, vi } from 'vitest';
import { buildSkillSettings, resolveSkillSettings } from './skill-allowlist-settings.js';
import { SkillInventoryUnavailableError, type ClaudeSkillInventory } from './plugin-classification.js';

const inv: ClaudeSkillInventory = {
  userSkills: ['keep', 'drop'],
  plugins: [
    { id: 'so@m', name: 'so', skills: ['a', 'b'], kind: 'skills-only' },
    { id: 'mx@m', name: 'mx', skills: ['c'], kind: 'mixed' },
    { id: 'part@m', name: 'part', skills: ['x', 'y'], kind: 'skills-only' },
    { id: 'unk@m', name: 'unk', skills: [], kind: 'mixed' },
    { id: 'none@m', name: 'none', skills: [], kind: 'skills-only' }
  ]
};

describe('buildSkillSettings', () => {
  it('unrestricted -> nothing', () => {
    expect(buildSkillSettings(undefined, inv)).toEqual({ bestEffortPlugins: [], disabledMixedPlugins: [] });
  });
  it('empty allowlist is restricted', () => {
    const r = buildSkillSettings([], inv);
    expect(r.settings?.skillOverrides).toEqual({ keep: 'off', drop: 'off' });
    expect(r.settings?.enabledPlugins).toEqual({ 'so@m': false, 'mx@m': false, 'part@m': false, 'unk@m': false, 'none@m': false });
    expect(r.disabledMixedPlugins).toEqual(['mx@m', 'unk@m']);
    expect(r.bestEffortPlugins).toEqual([]);
    expect(r.settings?.strictMcp).toBe(true);
  });
  it('non-empty allowlist never sets strictMcp', () => {
    expect(buildSkillSettings(['keep'], inv).settings?.strictMcp).toBeUndefined();
  });
  it('allowlist of only always-allowed skills (the resolved lean shape) goes strict-MCP', () => {
    expect(buildSkillSettings(['zcc-inbox'], inv).settings?.strictMcp).toBe(true);
    expect(buildSkillSettings(['zcc-inbox', 'keep'], inv).settings?.strictMcp).toBeUndefined();
  });
  it('empty allowlist with nothing in the inventory still goes strict-MCP', () => {
    expect(buildSkillSettings([], { userSkills: [], plugins: [] }).settings).toEqual({ strictMcp: true });
  });
  it('supports exact, plugin:skill and :name forms', () => {
    const r = buildSkillSettings(['keep', 'part:x', ':a'], inv);
    expect(r.settings?.skillOverrides).toEqual({ drop: 'off' });
    expect(r.settings?.enabledPlugins).toEqual({ 'mx@m': false, 'unk@m': false, 'none@m': false });
    expect(r.bestEffortPlugins).toContain('part@m');
  });
  it('mixed plugin with an allowed skill stays on (best effort); fully unallowed mixed plugin is switched off', () => {
    const r = buildSkillSettings(['mx:c'], inv);
    expect(r.settings?.enabledPlugins).toEqual({ 'so@m': false, 'part@m': false, 'unk@m': false, 'none@m': false });
    expect(r.disabledMixedPlugins).toEqual(['unk@m']);
    expect(r.bestEffortPlugins).toEqual([]);
  });
  it('a mixed plugin with a partly-allowed skill set is best effort, not disabled', () => {
    const r = buildSkillSettings(['m2:p'], { userSkills: [], plugins: [{ id: 'm2@m', name: 'm2', skills: ['p', 'q'], kind: 'mixed' }] });
    expect(r.settings).toBeUndefined();
    expect(r.bestEffortPlugins).toEqual(['m2@m']);
  });
  it('nothing to trim -> no settings', () => {
    const r = buildSkillSettings(['keep', 'drop'], { userSkills: ['keep'], plugins: [] });
    expect(r).toEqual({ bestEffortPlugins: [], disabledMixedPlugins: [] });
  });
});

describe('resolveSkillSettings', () => {
  it('unset allowlist skips scans', async () => {
    const local = vi.fn();
    expect(await resolveSkillSettings({ allowlist: undefined }, { local })).toEqual({ bestEffortPlugins: [], disabledMixedPlugins: [] });
    expect(local).not.toHaveBeenCalled();
  });
  it('local scan', async () => {
    const local = vi.fn(async () => inv);
    const r = await resolveSkillSettings({ allowlist: [], cwd: '/w' }, { local });
    expect(local).toHaveBeenCalledWith({ cwd: '/w' });
    expect(r.settings).toBeDefined();
  });
  it('local unavailable error becomes an unavailable result; other errors propagate', async () => {
    const local = vi.fn(async () => { throw new SkillInventoryUnavailableError('cannot read /x: EACCES'); });
    expect(await resolveSkillSettings({ allowlist: [] }, { local })).toEqual({ bestEffortPlugins: [], disabledMixedPlugins: [], unavailable: 'cannot read /x: EACCES' });
    const boom = vi.fn(async () => { throw new Error('boom'); });
    await expect(resolveSkillSettings({ allowlist: [] }, { local: boom })).rejects.toThrow('boom');
  });
  it('remote scan uses remotePath and reports unavailable', async () => {
    const remote = vi.fn(async () => undefined);
    const r = await resolveSkillSettings({ allowlist: [], cwd: '/c', remote: { remotePath: '/r' } as never }, { remote });
    expect(remote).toHaveBeenCalledWith({ remotePath: '/r' }, '/r');
    expect(r.unavailable).toMatch(/unavailable/);
    const ok = await resolveSkillSettings({ allowlist: [], remote: {} as never }, { remote: vi.fn(async () => inv) });
    expect(ok.settings).toBeDefined();
  });
});
