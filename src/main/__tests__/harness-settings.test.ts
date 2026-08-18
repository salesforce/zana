import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readCodexProjectSettings,
  readOpenCodeProjectSettings,
  writeCodexProjectSettings,
  writeOpenCodeProjectSettings
} from '../harness-settings.js';

describe('harness settings', () => {
  let project: string;

  beforeEach(async () => { project = await mkdtemp(join(tmpdir(), 'harness-settings-')); });
  afterEach(async () => { await rm(project, { recursive: true, force: true }); });

  it('creates and preserves unknown Codex project settings', async () => {
    const first = await writeCodexProjectSettings(project, { model: 'gpt-5', approvalPolicy: 'on-request' }, null);
    expect(first.state).toBe('valid');
    await mkdir(join(project, '.codex'), { recursive: true });
    const file = join(project, '.codex', 'config.toml');
    await writeFile(file, 'model = "gpt-5"\ncustom = true\n');
    const current = await readCodexProjectSettings(project);
    if (current.state !== 'valid') throw new Error('fixture not valid');
    expect(current.settings._unknown).toEqual(['custom']);
    await writeCodexProjectSettings(project, { sandboxMode: 'workspace-write' }, current.hash);
    await expect(readFile(file, 'utf-8')).resolves.toContain('custom = true');
  });

  it('rejects malformed Codex TOML and stale writes', async () => {
    await mkdir(join(project, '.codex'), { recursive: true });
    const file = join(project, '.codex', 'config.toml');
    await writeFile(file, 'invalid = [');
    await expect(readCodexProjectSettings(project)).resolves.toMatchObject({ state: 'invalid' });
    await expect(writeCodexProjectSettings(project, { model: 'gpt-5' }, null)).resolves.toMatchObject({ state: 'invalid' });
    await expect(readFile(file, 'utf-8')).resolves.toBe('invalid = [');
    await writeFile(file, '');
    const empty = await readCodexProjectSettings(project);
    if (empty.state !== 'valid') throw new Error('fixture not valid');
    const initial = await writeCodexProjectSettings(project, { model: 'gpt-5' }, empty.hash);
    expect(initial.state).toBe('valid');
    await writeFile(file, 'model = "external"\n');
    const current = await readCodexProjectSettings(project);
    if (current.state !== 'valid') throw new Error('fixture not valid');
    await writeFile(file, 'model = "changed"\n');
    await expect(writeCodexProjectSettings(project, { model: 'gpt-5' }, current.hash)).resolves.toMatchObject({ state: 'io-error' });
  });

  it('creates, preserves unknown, and rejects stale OpenCode project settings', async () => {
    const first = await writeOpenCodeProjectSettings(project, { model: 'aisuite/gpt-5.6-terra' }, null);
    expect(first.state).toBe('valid');
    const file = join(project, 'opencode.json');
    await writeFile(file, JSON.stringify({ model: 'aisuite/gpt-5.6-terra', mcp: { test: {} } }));
    const current = await readOpenCodeProjectSettings(project);
    if (current.state !== 'valid') throw new Error('fixture not valid');
    expect(current.settings._unknown).toEqual(['mcp']);
    await writeOpenCodeProjectSettings(project, { defaultAgent: 'build' }, current.hash);
    await expect(readFile(file, 'utf-8')).resolves.toContain('"mcp"');
    await writeFile(file, '{}');
    await expect(writeOpenCodeProjectSettings(project, { model: 'changed' }, current.hash)).resolves.toMatchObject({ state: 'io-error' });
  });

  it('rejects malformed OpenCode JSON', async () => {
    await writeFile(join(project, 'opencode.json'), '{ broken');
    await expect(readOpenCodeProjectSettings(project)).resolves.toMatchObject({ state: 'invalid' });
    await expect(writeOpenCodeProjectSettings(project, { model: 'one' }, null)).resolves.toMatchObject({ state: 'invalid' });
    await expect(readFile(join(project, 'opencode.json'), 'utf-8')).resolves.toBe('{ broken');
  });

  it('rejects unsafe harness settings paths', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'harness-settings-outside-'));
    try {
      await symlink(outside, join(project, '.codex'));
      await expect(readCodexProjectSettings(project)).resolves.toMatchObject({ state: 'io-error' });
      await rm(join(project, '.codex'));
      await mkdir(join(project, '.codex'));
      await writeFile(join(outside, 'config.toml'), 'model = "outside"\n');
      await symlink(join(outside, 'config.toml'), join(project, '.codex', 'config.toml'));
      await expect(readCodexProjectSettings(project)).resolves.toMatchObject({ state: 'io-error' });
      await writeFile(join(outside, 'opencode.json'), '{}');
      await symlink(join(outside, 'opencode.json'), join(project, 'opencode.json'));
      await expect(readOpenCodeProjectSettings(project)).resolves.toMatchObject({ state: 'io-error' });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('rejects non-file and oversized settings files', async () => {
    await mkdir(join(project, '.codex', 'config.toml'), { recursive: true });
    await expect(readCodexProjectSettings(project)).resolves.toMatchObject({ state: 'io-error' });
    await rm(join(project, '.codex'), { recursive: true });
    await writeFile(join(project, 'opencode.json'), `{\"value\":\"${'x'.repeat(256 * 1024)}\"}`);
    await expect(readOpenCodeProjectSettings(project)).resolves.toMatchObject({ state: 'io-error' });
  });

  it('serializes concurrent writes with one observed hash', async () => {
    const initial = await writeOpenCodeProjectSettings(project, { model: 'one' }, null);
    if (initial.state !== 'valid') throw new Error('initial write failed');
    const results = await Promise.all([
      writeOpenCodeProjectSettings(project, { model: 'two' }, initial.hash),
      writeOpenCodeProjectSettings(project, { model: 'three' }, initial.hash)
    ]);
    expect(results.map(({ state }) => state).sort()).toEqual(['io-error', 'valid']);
  });

  it('rejects invalid structured patches without changing files', async () => {
    const codex = await writeCodexProjectSettings(project, { model: 'gpt-5' }, null);
    if (codex.state !== 'valid') throw new Error('initial write failed');
    const codexFile = join(project, '.codex', 'config.toml');
    const beforeCodex = await readFile(codexFile, 'utf-8');
    await expect(writeCodexProjectSettings(project, { approvalPolicy: 'unsafe' }, codex.hash)).resolves.toMatchObject({ state: 'io-error' });
    await expect(readFile(codexFile, 'utf-8')).resolves.toBe(beforeCodex);

    const openCode = await writeOpenCodeProjectSettings(project, { model: 'one' }, null);
    if (openCode.state !== 'valid') throw new Error('initial write failed');
    const openCodeFile = join(project, 'opencode.json');
    const beforeOpenCode = await readFile(openCodeFile, 'utf-8');
    await expect(writeOpenCodeProjectSettings(project, { model: 42 }, openCode.hash)).resolves.toMatchObject({ state: 'io-error' });
    await expect(readFile(openCodeFile, 'utf-8')).resolves.toBe(beforeOpenCode);
  });
});
