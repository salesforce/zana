import { describe, expect, it, vi } from 'vitest';
import { ThreadCreateError } from '../http/thread-create.js';
import {
  collectPluginMentionResources,
  resolvePluginMentionContextInputs,
  splitPluginMentionItemId,
  withDeadline,
  withResolvedPluginMentionContext
} from './plugin-mentions.js';

describe('plugin mentions', () => {
  it('splits provider-prefixed item ids', () => {
    expect(splitPluginMentionItemId('issue:acme/app#1')).toEqual({
      providerId: 'issue',
      nativeId: 'acme/app#1'
    });
    expect(splitPluginMentionItemId('note:vault:path.md')).toEqual({
      providerId: 'note',
      nativeId: 'vault:path.md'
    });
    expect(splitPluginMentionItemId('issue')).toBeNull();
    expect(splitPluginMentionItemId(':bare')).toBeNull();
  });

  it('collects unique plugin mentions in first-appearance order', () => {
    expect(collectPluginMentionResources([
      {
        type: 'text',
        text: 'fix @bug and @bug',
        mentions: [
          {
            start: 4,
            end: 8,
            resource: { kind: 'plugin', pluginId: 'github', itemId: 'issue:acme/app#1', label: 'bug' }
          },
          {
            start: 13,
            end: 17,
            resource: { kind: 'plugin', pluginId: 'github', itemId: 'issue:acme/app#1', label: 'bug' }
          },
          {
            start: 18,
            end: 22,
            resource: { kind: 'path', path: 'src/foo.ts' }
          }
        ]
      },
      {
        type: 'text',
        text: '@task',
        mentions: [{
          start: 0,
          end: 5,
          resource: { kind: 'plugin', pluginId: 'tasks', itemId: 'task:9', label: 'Loop' }
        }]
      }
    ])).toEqual([
      { kind: 'plugin', pluginId: 'github', itemId: 'issue:acme/app#1', label: 'bug' },
      { kind: 'plugin', pluginId: 'tasks', itemId: 'task:9', label: 'Loop' }
    ]);
  });

  it('appends agent-only context after a successful resolve', async () => {
    const resolveMention = vi.fn(async () => ({ ok: true as const, context: 'Issue body' }));
    const input = [{
      type: 'text',
      text: 'fix @bug',
      mentions: [{
        start: 4,
        end: 8,
        resource: { kind: 'plugin', pluginId: 'github', itemId: 'issue:acme/app#1', label: 'bug' }
      }]
    }];
    const next = await withResolvedPluginMentionContext({ resolveMention }, input);
    expect(resolveMention).toHaveBeenCalledWith({ pluginId: 'github', itemId: 'issue:acme/app#1' });
    expect(next).toEqual([
      ...input,
      {
        type: 'text',
        text: 'Context for @bug (resolved by plugin "github"):\n\nIssue body',
        mentions: [],
        visibility: 'agent-only'
      }
    ]);
  });

  it('throws 422 when resolve fails or the plugin host is missing', async () => {
    const input = [{
      type: 'text',
      text: '@bug',
      mentions: [{
        start: 0,
        end: 4,
        resource: { kind: 'plugin', pluginId: 'github', itemId: 'issue:1', label: 'bug' }
      }]
    }];
    await expect(resolvePluginMentionContextInputs(undefined, input)).rejects.toMatchObject({
      status: 422,
      code: 'plugin_mention_resolve_failed'
    });
    await expect(
      resolvePluginMentionContextInputs(
        { resolveMention: async () => ({ ok: false, error: 'gone' }) },
        input
      )
    ).rejects.toBeInstanceOf(ThreadCreateError);
  });

  it('times out a hung resolve', async () => {
    await expect(
      withDeadline(new Promise(() => undefined), 10, 'mention resolve')
    ).rejects.toThrow(/timed out after 10ms/);
  });
});
