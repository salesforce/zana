import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { collectTestPluginApp } from '@zana-ai/zcc-plugin-sdk/testing/app';
import { derivePluginId, readPluginManifest } from '@zana-ai/zcc-domain';
import plugin, { MAX_CUSTOM_INSTRUCTIONS_LENGTH } from '../server.mjs';
import app from '../app.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cliCtx = { pluginId: 'custom-instructions', argv: [] };

describe('custom-instructions plugin', () => {
  it('derives a stable id', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string };
    expect(derivePluginId(pkg.name)).toBe('custom-instructions');
    expect(readPluginManifest(pkg).appEntry).toBe('./app.js');
  });

  it('loads persisted instructions and contributes them to agent threads', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'custom-instructions' });
    await zcc.storage.kv.set('customInstructions', 'Use concise answers.');

    await plugin(zcc);

    expect(await harness.callRpc('getInstructions')).toEqual({
      instructions: 'Use concise answers.',
      maxLength: MAX_CUSTOM_INSTRUCTIONS_LENGTH
    });
    expect(harness.extraInstructions).toEqual(['Use concise answers.']);
  });

  it('persists saves and applies them immediately', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'custom-instructions' });
    await plugin(zcc);

    await expect(
      harness.callRpc('saveInstructions', { instructions: 'Always run focused tests.' })
    ).resolves.toEqual({
      instructions: 'Always run focused tests.',
      maxLength: MAX_CUSTOM_INSTRUCTIONS_LENGTH
    });
    await expect(zcc.storage.kv.get('customInstructions')).resolves.toBe(
      'Always run focused tests.'
    );
    expect(harness.extraInstructions).toEqual(['Always run focused tests.']);
  });

  it('provides CLI parity for reading and updating instructions', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'custom-instructions' });
    await plugin(zcc);

    await expect(
      harness.cli?.run(['set', 'Prefer', 'small', 'commits.', '--json'], cliCtx)
    ).resolves.toMatchObject({
      exitCode: 0,
      stdout: JSON.stringify({ instructions: 'Prefer small commits.' })
    });
    await expect(harness.cli?.run(['get'], cliCtx)).resolves.toMatchObject({
      exitCode: 0,
      stdout: 'Prefer small commits.'
    });
    await expect(zcc.storage.kv.get('customInstructions')).resolves.toBe(
      'Prefer small commits.'
    );
    await expect(harness.cli?.run(['clear', '--json'], cliCtx)).resolves.toMatchObject({
      exitCode: 0,
      stdout: JSON.stringify({ instructions: '' })
    });
    expect(harness.extraInstructions).toEqual([]);
    await expect(harness.cli?.run(['set', 'Keep', 'going.'], cliCtx)).resolves.toMatchObject({
      exitCode: 0,
      stdout: 'Custom instructions updated'
    });
    expect(harness.extraInstructions).toEqual(['Keep going.']);
  });

  it('contributes nothing for blank text and rejects malformed or oversized saves', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'custom-instructions' });
    await plugin(zcc);

    expect(harness.extraInstructions).toEqual([]);
    await expect(harness.callRpc('saveInstructions', { instructions: 42 })).rejects.toMatchObject({
      code: 'invalid_input',
      issues: expect.any(Array)
    });
    await expect(
      harness.callRpc('saveInstructions', {
        instructions: 'x'.repeat(MAX_CUSTOM_INSTRUCTIONS_LENGTH + 1)
      })
    ).rejects.toMatchObject({
      code: 'invalid_input',
      issues: expect.any(Array)
    });
    await expect(
      harness.callRpc('saveInstructions', {
        instructions: 'ok',
        ignored: true
      })
    ).rejects.toMatchObject({
      code: 'invalid_input',
      issues: expect.any(Array)
    });
    await expect(harness.callRpc('getInstructions', { ignored: true })).rejects.toMatchObject({
      code: 'invalid_input',
      issues: expect.any(Array)
    });
    await expect(harness.callRpc('saveInstructions', null)).rejects.toMatchObject({
      code: 'invalid_input',
      issues: expect.any(Array)
    });
    await expect(harness.callRpc('saveInstructions', [])).rejects.toMatchObject({
      code: 'invalid_input',
      issues: expect.any(Array)
    });
    await expect(harness.callRpc('saveInstructions', { instructions: '' })).resolves.toEqual({
      instructions: '',
      maxLength: MAX_CUSTOM_INSTRUCTIONS_LENGTH
    });
    expect(harness.extraInstructions).toEqual([]);
  });

  it('treats a non-string KV value as blank and reports unknown CLI usage', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'custom-instructions' });
    await zcc.storage.kv.set('customInstructions', { nope: true });
    await plugin(zcc);
    expect(harness.extraInstructions).toEqual([]);
    await expect(harness.cli?.run(['get', '--json'], cliCtx)).resolves.toMatchObject({
      exitCode: 0,
      stdout: JSON.stringify({ instructions: '' })
    });
    await expect(harness.cli?.run(['nope'], cliCtx)).resolves.toMatchObject({
      exitCode: 1,
      stderr: 'Usage: zcc instructions get|set <text...>|clear [--json]'
    });
  });

  it('registers a Settings section without a competing title field', () => {
    const set = collectTestPluginApp(app, 'custom-instructions');
    expect(set.settingsSections[0]?.id).toBe('custom-instructions');
    expect(set.settingsSections[0]?.title).toBeUndefined();
  });
});
