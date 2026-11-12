import { afterEach, describe, expect, it, vi } from 'vitest';
import { derivedProviderOptionsForCommand } from './derived-provider-options.js';
import { registerThreadProvider } from './thread-provider-catalog.js';

const CAPABILITIES = {
  supportsServiceTier: false,
  fork: 'checkpoint' as const,
  supportsThreadArchive: false,
  supportsThreadRename: false,
  permissionModes: ['full']
};

describe('derivedProviderOptionsForCommand', () => {
  const handles: Array<{ unregister(): void }> = [];

  afterEach(() => {
    for (const handle of handles.splice(0)) handle.unregister();
  });

  it('returns undefined when the provider has no derive hook', async () => {
    handles.push(
      registerThreadProvider('provider-test', {
        id: 'plain',
        displayName: 'Plain',
        capabilities: CAPABILITIES
      })
    );
    expect(
      await derivedProviderOptionsForCommand({
        providerId: 'plain',
        threadId: 't1',
        projectId: 'p1',
        permissionMode: 'full'
      })
    ).toBeUndefined();
  });

  it('derives options from plugin settings and omits secrets', async () => {
    handles.push(
      registerThreadProvider('provider-claude-code', {
        id: 'claude-code-derive',
        displayName: 'Claude',
        capabilities: CAPABILITIES,
        deriveProviderOptions(context) {
          return {
            memoryEnabled: context.settings.memoryEnabled !== false,
            token: context.settings.token,
            promptMode: context.promptMode ?? null
          };
        }
      })
    );
    expect(
      await derivedProviderOptionsForCommand({
        providerId: 'claude-code-derive',
        threadId: 't1',
        projectId: 'p1',
        permissionMode: 'full',
        promptMode: 'plan',
        plugins: {
          getSettings() {
            return {
              descriptors: {
                memoryEnabled: {},
                token: { secret: true }
              },
              values: { memoryEnabled: false, token: 'secret-value' }
            };
          }
        }
      })
    ).toEqual({
      memoryEnabled: false,
      token: undefined,
      promptMode: 'plan'
    });
  });

  it('awaits a worker-backed hook before admitting options into a host command', async () => {
    const pending = Promise.withResolvers<Record<string, unknown>>();
    const hook = vi.fn(() => pending.promise);
    handles.push(registerThreadProvider('worker-plugin', { id: 'worker-derived', displayName: 'Worker', capabilities: CAPABILITIES, deriveProviderOptions: hook as never }));
    const args = { providerId: 'worker-derived', threadId: 't1', projectId: 'p1', permissionMode: 'full', model: 'fixture-model' };
    const read = derivedProviderOptionsForCommand(args), settled = vi.fn();
    void read.then(settled); await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    expect(hook).toHaveBeenCalledWith({ threadId: 't1', projectId: 'p1', permissionMode: 'full', model: 'fixture-model', settings: {} });
    pending.resolve({ memoryEnabled: false });
    await expect(read).resolves.toEqual({ memoryEnabled: false });
  });

  it.each([undefined, null, [], 'invalid'])('rejects malformed resolved options: %s', async value => {
    handles.push(registerThreadProvider('worker-plugin', { id: 'malformed-derived', displayName: 'Worker', capabilities: CAPABILITIES, deriveProviderOptions: (() => Promise.resolve(value)) as never }));
    await expect(derivedProviderOptionsForCommand({ providerId: 'malformed-derived', threadId: 't1', projectId: 'p1', permissionMode: 'full' })).resolves.toBeUndefined();
  });

  it('propagates worker failure instead of dispatching unresolved options', async () => {
    handles.push(registerThreadProvider('worker-plugin', { id: 'failed-derived', displayName: 'Worker', capabilities: CAPABILITIES, deriveProviderOptions: (() => Promise.reject(Error('worker unavailable'))) as never }));
    await expect(derivedProviderOptionsForCommand({ providerId: 'failed-derived', threadId: 't1', projectId: 'p1', permissionMode: 'full' })).rejects.toThrow('worker unavailable');
    await expect(derivedProviderOptionsForCommand({ providerId: 'missing', threadId: 't1', projectId: 'p1', permissionMode: 'full' })).resolves.toBeUndefined();
  });

  it('merges the main-authorized skill allowlist even without a provider hook', async () => {
    handles.push(registerThreadProvider('provider-test', { id: 'plain-skills', displayName: 'Plain', capabilities: CAPABILITIES }));
    const base = { providerId: 'plain-skills', threadId: 't1', projectId: 'p1', permissionMode: 'full' };
    expect(await derivedProviderOptionsForCommand({ ...base, skillSelection: { automatedSkillIds: ['zcc:a/review'], allowedSkillNames: ['x'] } }))
      .toEqual({ skillAllowlist: ['zcc-inbox', 'x', 'review'] });
    expect(await derivedProviderOptionsForCommand({ ...base, skillSelection: { allowedSkillNames: [] } }))
      .toEqual({ skillAllowlist: ['zcc-inbox'] });
    expect(await derivedProviderOptionsForCommand({ ...base, skillSelection: {} })).toBeUndefined();
  });

  it('merges the main-authorized persona MCP allowlist, alone and with skills; an empty restriction is kept', async () => {
    handles.push(registerThreadProvider('provider-test', { id: 'plain-mcp', displayName: 'Plain', capabilities: CAPABILITIES }));
    const base = { providerId: 'plain-mcp', threadId: 't1', projectId: 'p1', permissionMode: 'full' };
    expect(await derivedProviderOptionsForCommand({ ...base, skillSelection: { mcpAllowlist: ['zcc-inbox', 'github'] } }))
      .toEqual({ mcpAllowlist: ['zcc-inbox', 'github'] });
    expect(await derivedProviderOptionsForCommand({ ...base, skillSelection: { mcpAllowlist: [] } })).toEqual({ mcpAllowlist: [] });
    expect(await derivedProviderOptionsForCommand({ ...base, skillSelection: { allowedSkillNames: [], mcpAllowlist: ['zcc-inbox'] } }))
      .toEqual({ skillAllowlist: ['zcc-inbox'], mcpAllowlist: ['zcc-inbox'] });
  });

  it('adds skillAllowlist on top of derived options, and for a non-object derive result', async () => {
    handles.push(registerThreadProvider('provider-claude-code', {
      id: 'claude-skills', displayName: 'C', capabilities: CAPABILITIES,
      deriveProviderOptions: () => ({ memoryEnabled: true })
    }));
    handles.push(registerThreadProvider('provider-test', {
      id: 'null-skills', displayName: 'N', capabilities: CAPABILITIES,
      deriveProviderOptions: () => null as never
    }));
    const base = { threadId: 't1', projectId: 'p1', permissionMode: 'full', skillSelection: { allowedSkillNames: ['x'] } };
    expect(await derivedProviderOptionsForCommand({ ...base, providerId: 'claude-skills' }))
      .toEqual({ memoryEnabled: true, skillAllowlist: ['zcc-inbox', 'x'] });
    expect(await derivedProviderOptionsForCommand({ ...base, providerId: 'null-skills' }))
      .toEqual({ skillAllowlist: ['zcc-inbox', 'x'] });
  });
});
