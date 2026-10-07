import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPluginApi, type PluginHandle } from './plugin-api.js';

const history = vi.hoisted(() => vi.fn(async () => ({ entries: [], nextCursor: null })));
vi.mock('../services/threads/conversation-prompt-history.js', () => ({ pagedConversationPromptHistory: history }));
const handles: PluginHandle[] = [], dirs: string[] = [];
function create(productContext?: NonNullable<Parameters<typeof createPluginApi>[2]>['productContext']) {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-prompt-history-'));
  dirs.push(dir);
  const handle = createPluginApi('history-fixture', dir, { productContext });
  handles.push(handle);
  return handle;
}
afterEach(async () => {
  await Promise.all(handles.splice(0).map(handle => handle.dispose()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('plugin prompt history runtime boundary', () => {
  it('rejects an unavailable runtime and invalid scope before querying saved prompts', async () => {
    await expect(create().api.sdk.experimental_promptHistory.list({ scope: 'all' })).rejects.toThrow('not available');
    const handle = create({ db: {} } as never);
    await expect(handle.api.sdk.experimental_promptHistory.list({ scope: 'foreign' } as never)).rejects.toThrow('Invalid history scope');
    await expect(handle.api.sdk.experimental_promptHistory.list(undefined as never)).rejects.toThrow('Invalid history scope');
    expect(history).not.toHaveBeenCalled();
  });

  it.each(['thread', 'project', 'all'] as const)('delegates %s scope to authoritative paging and rejects a stale plugin', async scope => {
    const context = { db: {} } as never;
    const handle = create(context);
    const args = { scope, threadId: 'thread-1', projectId: 'project-1', cursor: 'page', query: 'saved prompt' };
    await expect(handle.api.sdk.experimental_promptHistory.list(args)).resolves.toEqual({ entries: [], nextCursor: null });
    expect(history).toHaveBeenCalledWith(context, args);
    await handle.dispose();
    history.mockClear();
    await expect(handle.api.sdk.experimental_promptHistory.list(args)).rejects.toThrow('stale');
    expect(history).not.toHaveBeenCalled();
  });
});
