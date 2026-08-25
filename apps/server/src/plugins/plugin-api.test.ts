import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createPluginApi, validatePluginRequestInput } from './plugin-api.js';

describe('plugin requestInput validation', () => {
  it('accepts a well-formed request and trims the title', () => {
    expect(validatePluginRequestInput({
      threadId: 'thr-1',
      rendererId: 'confirm_form',
      title: '  Confirm  ',
      payload: { ok: true }
    })).toMatchObject({
      threadId: 'thr-1',
      rendererId: 'confirm_form',
      title: 'Confirm',
      payload: { ok: true },
      timeoutMs: 10 * 60 * 1000
    });
  });

  it('rejects missing threadId, bad rendererId, empty title, and oversized payloads', () => {
    expect(() => validatePluginRequestInput({
      threadId: '',
      rendererId: 'form',
      title: 'Hi',
      payload: {}
    } as never)).toThrow(/threadId/);
    expect(() => validatePluginRequestInput({
      threadId: 'thr-1',
      rendererId: 'bad id',
      title: 'Hi',
      payload: {}
    })).toThrow(/rendererId/);
    expect(() => validatePluginRequestInput({
      threadId: 'thr-1',
      rendererId: 'form',
      title: '',
      payload: {}
    })).toThrow(/title/);
    expect(() => validatePluginRequestInput({
      threadId: 'thr-1',
      rendererId: 'form',
      title: 'Hi',
      payload: 'x'.repeat(65 * 1024)
    })).toThrow(/64 KiB/);
    expect(() => validatePluginRequestInput({
      threadId: 'thr-1',
      rendererId: 'form',
      title: 'Hi',
      payload: {},
      timeoutMs: 0
    })).toThrow(/timeoutMs/);
    expect(() => validatePluginRequestInput({
      threadId: 'thr-1',
      rendererId: 'form',
      title: 'x'.repeat(161),
      payload: {}
    })).toThrow(/title/);
  });

  it('throws when requestInput has no backend', async () => {
    const handle = createPluginApi('ask-user', '/tmp');
    await expect(handle.api.ui.requestInput({
      threadId: 'thr-1',
      rendererId: 'form',
      title: 'Go',
      payload: {}
    })).rejects.toThrow(/not available/);
  });

  it('waits on the interaction backend and interrupts on dispose', async () => {
    const interrupted: string[] = [];
    const handle = createPluginApi('ask-user', '/tmp', {
      requestPluginInteraction: async () => ({ outcome: 'submitted', value: { ok: true } }),
      interruptPluginInteractions: (pluginId) => {
        interrupted.push(pluginId);
      }
    });
    await expect(handle.api.ui.requestInput({
      threadId: 'thr-1',
      rendererId: 'form',
      title: 'Go',
      payload: { n: 1 }
    })).resolves.toEqual({ outcome: 'submitted', value: { ok: true } });
    await handle.dispose();
    expect(interrupted).toEqual(['ask-user']);
  });
});

describe('plugin storage and settings', () => {
  it('persists kv across api instances', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-kv-'));
    try {
      const handle = createPluginApi('kv', dir);
      await handle.api.storage.kv.set('n', 3);
      await handle.dispose();
      const again = createPluginApi('kv', dir);
      await expect(again.api.storage.kv.get('n')).resolves.toBe(3);
      await again.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('persists settings.define defaults and host writes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-settings-'));
    try {
      const handle = createPluginApi('set', dir);
      const settings = handle.api.settings.define({
        token: { type: 'string', label: 'Token', default: 'x' }
      });
      expect(await settings.get()).toEqual({ token: 'x' });
      await handle.setSettings({ token: 'secret' });
      expect(await settings.get()).toEqual({ token: 'secret' });
      expect(handle.getSettings().values.token).toBe('secret');
      expect(handle.getSettings().descriptors.token?.label).toBe('Token');
      await handle.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
