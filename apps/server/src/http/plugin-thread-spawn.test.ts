import { describe, expect, it, vi } from 'vitest';
import type { EffectiveHarnessDefaultResult, HarnessVerifyResult } from '@zana-ai/zcc-domain/product';
import { PluginSpawnHarnessError, pluginProviderAvailable, resolvePluginSpawnProvider } from './plugin-thread-spawn.js';

const providers = [{ id: 'fake' }, { id: 'claude-code' }, { id: 'codex' }];
const ok = (family: 'claude' | 'codex' | 'pi', profile: string): EffectiveHarnessDefaultResult => ({
  ok: true,
  family,
  profile: profile as never,
  source: 'global-default'
});

describe('resolvePluginSpawnProvider', () => {
  it('lets an explicit providerId win without resolving the project default', async () => {
    const effectiveDefault = vi.fn(async () => ok('claude', 'claude'));
    await expect(resolvePluginSpawnProvider({ providerId: 'codex', harness: 'project-default', providers, effectiveDefault }))
      .resolves.toEqual({ providerId: 'codex' });
    expect(effectiveDefault).not.toHaveBeenCalled();
  });

  it('rejects an unknown explicit providerId', async () => {
    await expect(resolvePluginSpawnProvider({ providerId: 'nope', providers, effectiveDefault: vi.fn() }))
      .rejects.toThrow('unknown thread provider: nope');
  });

  it('maps the effective default family to its thread provider', async () => {
    await expect(resolvePluginSpawnProvider({
      harness: 'project-default',
      providers,
      effectiveDefault: async () => ok('codex', 'codex')
    })).resolves.toEqual({ providerId: 'codex', harness: { family: 'codex', profile: 'codex' } });
  });

  it('turns a yolo default into full permission', async () => {
    await expect(resolvePluginSpawnProvider({
      harness: 'project-default',
      providers,
      effectiveDefault: async () => ok('codex', 'codex-yolo')
    })).resolves.toEqual({ providerId: 'codex', permissionMode: 'full', harness: { family: 'codex', profile: 'codex-yolo' } });
    await expect(resolvePluginSpawnProvider({
      harness: 'project-default',
      providers,
      effectiveDefault: async () => ok('claude', 'claude-yolo')
    })).resolves.toEqual({ providerId: 'claude-code', permissionMode: 'full', harness: { family: 'claude', profile: 'claude-yolo' } });
  });

  it('throws an actionable error for UNAVAILABLE_DEFAULT instead of falling back', async () => {
    const error = await resolvePluginSpawnProvider({
      harness: 'project-default',
      providers,
      effectiveDefault: async () => ({ ok: false, code: 'UNAVAILABLE_DEFAULT', message: 'Configured default harness is disabled or unavailable' })
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PluginSpawnHarnessError);
    expect((error as Error).message).toBe(
      'No usable AI harness: Configured default harness is disabled or unavailable. Choose an installed, enabled harness in Settings → AI Harness.'
    );
  });

  it('throws when the host cannot be reached', async () => {
    await expect(resolvePluginSpawnProvider({
      harness: 'project-default',
      providers,
      effectiveDefault: async () => { throw new Error('host offline'); }
    })).rejects.toThrow('No usable AI harness: host offline. Choose an installed');
    await expect(resolvePluginSpawnProvider({
      harness: 'project-default',
      providers,
      effectiveDefault: async () => { throw 'boom'; }
    })).rejects.toThrow('No usable AI harness: the host could not be reached.');
  });

  it('throws when the default family has no loaded thread provider', async () => {
    await expect(resolvePluginSpawnProvider({
      harness: 'project-default',
      providers,
      effectiveDefault: async () => ok('pi', 'pi')
    })).rejects.toThrow('the project default (pi) has no loaded thread provider');
  });

  it('keeps the legacy first-provider fallback only when neither field is set', async () => {
    const effectiveDefault = vi.fn();
    await expect(resolvePluginSpawnProvider({ providers, effectiveDefault })).resolves.toEqual({ providerId: 'fake' });
    expect(effectiveDefault).not.toHaveBeenCalled();
    await expect(resolvePluginSpawnProvider({ providers: [], effectiveDefault })).rejects.toThrow('no thread provider is registered');
  });

  it("prefers Settings' default harness, then a usable provider, in the legacy fallback", async () => {
    const effectiveDefault = vi.fn();
    const list = [{ id: 'fake', unavailableReason: 'offline' }, { id: 'claude-code' }];
    await expect(resolvePluginSpawnProvider({ providers: list, effectiveDefault })).resolves.toEqual({ providerId: 'claude-code' });
    await expect(resolvePluginSpawnProvider({ providers: [...list, { id: 'codex' }], defaultHarness: 'codex', effectiveDefault })).resolves.toEqual({ providerId: 'codex' });
  });
});

describe('pluginProviderAvailable', () => {
  const verify = (family: 'claude' | 'codex', installed: boolean, enabled: boolean): HarnessVerifyResult => ({
    family,
    label: family,
    binary: family,
    enabled,
    installed,
    installHint: ''
  } as HarnessVerifyResult);

  it('reports a provider whose plugin bridge failed as unavailable', () => {
    expect(pluginProviderAvailable({ id: 'codex', unavailableReason: 'bridge failed' }, null)).toBe(false);
  });

  it('falls back to bridge state when the host cannot be probed', () => {
    expect(pluginProviderAvailable({ id: 'codex' }, null)).toBe(true);
  });

  it('requires an installed and enabled harness when the host was probed', () => {
    const probe = (rows: HarnessVerifyResult[]) => ({ availability: rows, extraInstalled: {} });
    expect(pluginProviderAvailable({ id: 'codex' }, probe([verify('codex', true, true)]))).toBe(true);
    expect(pluginProviderAvailable({ id: 'codex' }, probe([verify('codex', true, false)]))).toBe(false);
    expect(pluginProviderAvailable({ id: 'codex' }, probe([verify('codex', false, true)]))).toBe(false);
    expect(pluginProviderAvailable({ id: 'fake' }, probe([]))).toBe(true);
  });
});
