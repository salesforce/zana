import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createQueuedMessage,
  deleteQueuedMessage,
  listQueuedMessages,
  queuedMessageText,
  reorderQueuedMessage,
  updateQueuedMessage
} from './queued-messages.js';

const dirs: string[] = [];

function dataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-queued-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('queued messages store', () => {
  it('settles rejected edits without leaking an unhandled rejection or blocking the next write', async () => {
    const dir = dataDir();
    await expect(updateQueuedMessage(dir, 't1', 'missing', [], 0)).rejects.toMatchObject({ code: 'unknown-queued-message' });
    const first = await createQueuedMessage(dir, 't1', [{ type: 'text', text: 'kept', mentions: [] }]);
    await expect(updateQueuedMessage(dir, 't1', first.id, [], first.updatedAt - 1)).rejects.toMatchObject({ code: 'queued-message-conflict' });
    await expect(reorderQueuedMessage(dir, 't1', 'missing', null)).rejects.toMatchObject({ code: 'unknown-queued-message' });
    await new Promise<void>(resolve => setImmediate(resolve));
    await createQueuedMessage(dir, 't1', [{ type: 'text', text: 'next', mentions: [] }]);
    expect(listQueuedMessages(dir, 't1').map(queuedMessageText)).toEqual(['kept', 'next']);
  });

  it('creates, lists, reorders, edits, and deletes a queued prompt', async () => {
    const dir = dataDir();
    const first = await createQueuedMessage(dir, 't1', [{ type: 'text', text: 'one', mentions: [] }]);
    const second = await createQueuedMessage(dir, 't1', [{ type: 'text', text: 'two', mentions: [] }]);
    expect(listQueuedMessages(dir, 't1').map((row) => queuedMessageText(row))).toEqual(['one', 'two']);
    const reordered = await reorderQueuedMessage(dir, 't1', second.id, null);
    expect(reordered.map((row) => queuedMessageText(row))).toEqual(['two', 'one']);
    const edited = await updateQueuedMessage(dir, 't1', first.id, [{ type: 'text', text: 'one!', mentions: [] }], first.updatedAt);
    expect(queuedMessageText(edited)).toBe('one!');
    await deleteQueuedMessage(dir, 't1', second.id);
    expect(listQueuedMessages(dir, 't1')).toHaveLength(1);
  });
});
