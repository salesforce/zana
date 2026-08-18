import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile, symlink, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readClaudeProjectSettings, writeClaudeProjectSettings } from '../claude-settings.js';

describe('claude-settings', () => {
  let project: string;

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), 'claude-settings-'));
  });

  afterEach(async () => {
    await rm(project, { recursive: true, force: true });
  });

  it('reports a missing file with no hash', async () => {
    await expect(readClaudeProjectSettings(project, 'shared')).resolves.toEqual({
      state: 'missing', settings: {}, hash: null
    });
  });

  it('rejects unsupported scopes and malformed structured patches', async () => {
    await expect(readClaudeProjectSettings(project, 'global')).resolves.toMatchObject({ state: 'io-error' });
    await expect(writeClaudeProjectSettings(project, 'shared', { model: 1 }, null))
      .resolves.toMatchObject({ state: 'io-error' });
    await expect(writeClaudeProjectSettings(project, 'shared', {
      permissions: { allow: ['Read', 1] }
    }, null)).resolves.toMatchObject({ state: 'io-error' });
  });

  it('treats a JSON array as invalid rather than missing', async () => {
    await mkdir(join(project, '.claude'), { recursive: true });
    await writeFile(join(project, '.claude', 'settings.json'), '[]');
    await expect(readClaudeProjectSettings(project, 'shared')).resolves.toMatchObject({ state: 'invalid' });
  });

  it('keeps invalid known fields as unknown and removes cleared fields', async () => {
    await mkdir(join(project, '.claude'), { recursive: true });
    const file = join(project, '.claude', 'settings.json');
    await writeFile(file, JSON.stringify({
      model: 42,
      permissions: { allow: ['Read'], deny: 'not-an-array', defaultMode: 'invalid' }
    }));
    const current = await readClaudeProjectSettings(project, 'shared');
    expect(current).toMatchObject({ state: 'valid' });
    if (current.state !== 'valid') return;
    expect(current.settings._unknown).toEqual(['model']);
    expect(current.settings._unknownPermissions).toEqual(['deny', 'defaultMode']);
    await writeClaudeProjectSettings(project, 'shared', { permissions: { allow: [] } }, current.hash);
    const raw = JSON.parse(await readFile(file, 'utf-8'));
    expect(raw.permissions.allow).toBeUndefined();
    expect(raw.permissions.deny).toBe('not-an-array');
  });

  it('rejects non-file settings targets', async () => {
    await mkdir(join(project, '.claude', 'settings.json'), { recursive: true });
    await expect(readClaudeProjectSettings(project, 'shared')).resolves.toMatchObject({ state: 'io-error' });
  });

  it('reports inaccessible settings instead of treating them as missing', async () => {
    await mkdir(join(project, '.claude'), { recursive: true });
    const file = join(project, '.claude', 'settings.json');
    await writeFile(file, '{}');
    await chmod(file, 0o000);
    try {
      const result = await readClaudeProjectSettings(project, 'shared');
      // Root test runners can still read the file; non-root runners must return io-error.
      expect(['valid', 'io-error']).toContain(result.state);
    } finally {
      await chmod(file, 0o600);
    }
  });

  it('parses known fields and reports unknown fields read-only', async () => {
    await mkdir(join(project, '.claude'), { recursive: true });
    await writeFile(join(project, '.claude', 'settings.local.json'), JSON.stringify({
      permissions: { allow: ['Bash(git:*)'], defaultMode: 'plan', futureFlag: true },
      model: 'opus', env: { FOO: 'bar' }
    }));
    const result = await readClaudeProjectSettings(project, 'local');
    expect(result.state).toBe('valid');
    if (result.state !== 'valid') return;
    expect(result.settings.permissions?.allow).toEqual(['Bash(git:*)']);
    expect(result.settings.permissions?.defaultMode).toBe('plan');
    expect(result.settings.model).toBe('opus');
    expect(result.settings._unknown).toEqual(['env']);
    expect(result.settings._unknownPermissions).toEqual(['futureFlag']);
  });

  it('preserves on-disk unknown keys and ignores caller-provided unknown keys', async () => {
    await mkdir(join(project, '.claude'), { recursive: true });
    const file = join(project, '.claude', 'settings.json');
    await writeFile(file, JSON.stringify({ permissions: { defaultMode: 'plan', futureFlag: true }, env: { FOO: 'bar' } }));
    const current = await readClaudeProjectSettings(project, 'shared');
    if (current.state !== 'valid') throw new Error('fixture was not readable');
    await writeClaudeProjectSettings(project, 'shared', {
      permissions: { allow: ['Edit'] },
      _unknown: ['injected'],
      _unknownPermissions: ['injected']
    }, current.hash);
    await expect(readFile(file, 'utf-8')).resolves.toContain('futureFlag');
    const raw = JSON.parse(await readFile(file, 'utf-8'));
    expect(raw.env).toEqual({ FOO: 'bar' });
    expect(raw.permissions.futureFlag).toBe(true);
    expect(raw.injected).toBeUndefined();
  });

  it('rejects stale writes without overwriting the external edit', async () => {
    const first = await writeClaudeProjectSettings(project, 'shared', { model: 'haiku' }, null);
    if (first.state !== 'valid') throw new Error('initial write failed');
    const file = join(project, '.claude', 'settings.json');
    await writeFile(file, '{\n  "model": "external"\n}\n');
    const result = await writeClaudeProjectSettings(project, 'shared', { model: 'opus' }, first.hash);
    expect(result).toMatchObject({ state: 'io-error' });
    await expect(readFile(file, 'utf-8')).resolves.toContain('external');
  });

  it('preserves malformed bytes and prevents structured writes', async () => {
    await mkdir(join(project, '.claude'), { recursive: true });
    const file = join(project, '.claude', 'settings.json');
    const malformed = '{ not json';
    await writeFile(file, malformed);
    await expect(readClaudeProjectSettings(project, 'shared')).resolves.toMatchObject({ state: 'invalid' });
    await expect(writeClaudeProjectSettings(project, 'shared', { model: 'opus' }, null))
      .resolves.toMatchObject({ state: 'invalid' });
    await expect(readFile(file, 'utf-8')).resolves.toBe(malformed);
  });

  it('rejects symlinked Claude directories and files', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'claude-settings-outside-'));
    try {
      await symlink(outside, join(project, '.claude'));
      await expect(readClaudeProjectSettings(project, 'shared')).resolves.toMatchObject({ state: 'io-error' });
      await rm(join(project, '.claude'));
      await mkdir(join(project, '.claude'));
      await writeFile(join(outside, 'settings.json'), '{}');
      await symlink(join(outside, 'settings.json'), join(project, '.claude', 'settings.json'));
      await expect(readClaudeProjectSettings(project, 'shared')).resolves.toMatchObject({ state: 'io-error' });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('serializes updates with matching observed hashes', async () => {
    const initial = await writeClaudeProjectSettings(project, 'shared', { model: 'haiku' }, null);
    if (initial.state !== 'valid') throw new Error('initial write failed');
    const [first, second] = await Promise.all([
      writeClaudeProjectSettings(project, 'shared', { model: 'opus' }, initial.hash),
      writeClaudeProjectSettings(project, 'shared', { model: 'sonnet' }, initial.hash)
    ]);
    expect([first.state, second.state].sort()).toEqual(['io-error', 'valid']);
  });
});
