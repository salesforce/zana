import { afterEach, describe, expect, it } from 'vitest';
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

  it('returns undefined when the provider has no derive hook', () => {
    handles.push(
      registerThreadProvider('provider-test', {
        id: 'plain',
        displayName: 'Plain',
        capabilities: CAPABILITIES
      })
    );
    expect(
      derivedProviderOptionsForCommand({
        providerId: 'plain',
        threadId: 't1',
        projectId: 'p1',
        permissionMode: 'full'
      })
    ).toBeUndefined();
  });

  it('derives options from plugin settings and omits secrets', () => {
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
      derivedProviderOptionsForCommand({
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
});
