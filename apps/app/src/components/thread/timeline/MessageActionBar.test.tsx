import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { MessageActionBar } from './MessageActionBar.js';
import {
  COMPOSER_INSERT_EVENT,
  dispatchComposerQuote
} from '../secondary-panel/SecondaryPanelSelectionActions.js';

vi.mock('../../../lib/product-client.js', () => ({
  product: {
    threads: {
      fork: vi.fn(async () => ({ ok: true, value: { id: 'forked' } })),
      createQueuedMessage: vi.fn(async () => ({ ok: true }))
    }
  }
}));

describe('MessageActionBar', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders copy, add-to-chat, and fork for an assistant message', () => {
    const html = renderToStaticMarkup(
      <MessageActionBar
        text="Done."
        threadId="t1"
        sourceSeqEnd={12}
        onCopy={() => undefined}
        onFork={() => undefined}
        showFork
      />
    );
    expect(html).toContain('thread-copy-message');
    expect(html).toContain('aria-label="Copy message"');
    expect(html).toContain('thread-add-to-chat');
    expect(html).toContain('aria-label="Add to chat"');
    expect(html).toContain('thread-fork-message');
    expect(html).toContain('aria-label="Fork from this message"');
    expect(html).not.toContain('thread-edit-message');
    expect(html).not.toContain('thread-send-to-main');
  });

  it('renders edit on user messages and send-to-main on child-thread assistants', () => {
    const user = renderToStaticMarkup(
      <MessageActionBar
        text="Fix it"
        threadId="t1"
        onCopy={() => undefined}
        onEdit={() => undefined}
      />
    );
    expect(user).toContain('thread-edit-message');
    expect(user).toContain('thread-add-to-chat');
    expect(user).not.toContain('thread-fork-message');
    const child = renderToStaticMarkup(
      <MessageActionBar
        text="Done."
        threadId="child"
        onCopy={() => undefined}
        onSendToMain={() => undefined}
        showFork
      />
    );
    expect(child).toContain('thread-send-to-main');
    expect(child).toContain('thread-fork-message');
  });

  it('quotes the message into the composer for the same thread', () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', {
      dispatchEvent,
      getSelection: () => ({ toString: () => '' })
    });
    dispatchComposerQuote('t1', 'Show me the file');
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    const event = dispatchEvent.mock.calls[0]?.[0] as CustomEvent<{ threadId: string; text: string }>;
    expect(event.type).toBe(COMPOSER_INSERT_EVENT);
    expect(event.detail).toEqual({ threadId: 't1', text: '> Show me the file' });
  });

  it('wires copy, add-to-chat, and fork through the live thread view', () => {
    const detail = readFileSync(fileURLToPath(new URL('../../../views/threads/ThreadDetailView.tsx', import.meta.url)), 'utf8');
    expect(detail).toContain('void copyText(text);');
    expect(detail).toContain('product.threads.fork(threadId, sourceSeqEnd');
    const bar = readFileSync(fileURLToPath(new URL('./MessageActionBar.tsx', import.meta.url)), 'utf8');
    expect(bar).toContain('onCopy(text)');
    expect(bar).toContain('dispatchComposerQuote(threadId, selected || text)');
    expect(bar).toContain('onFork(sourceSeqEnd)');
    const composer = readFileSync(fileURLToPath(new URL('../../ThreadCommandComposer.tsx', import.meta.url)), 'utf8');
    expect(composer).toContain('COMPOSER_INSERT_EVENT');
    expect(composer).toContain('field.insertText(detail.text)');
    const row = readFileSync(fileURLToPath(new URL('./ConversationRow.tsx', import.meta.url)), 'utf8');
    expect(row).toContain('showFork={row.role === \'assistant\'}');
    expect(row).toContain('canEditConversationMessage(row, threadIdle)');
    expect(row).toContain('product.threads.createQueuedMessage(parentThreadId, { text })');
  });
});
