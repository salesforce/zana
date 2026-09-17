import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { MessageActionBar } from './MessageActionBar.js';

vi.mock('../../../lib/product-client.js', () => ({
  product: {
    threads: {
      fork: vi.fn(async () => ({ ok: true, value: { id: 'forked' } })),
      createQueuedMessage: vi.fn(async () => ({ ok: true }))
    }
  }
}));

describe('MessageActionBar', () => {

  it('renders copy and fork for an assistant message without add-to-chat', () => {
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
    expect(html).toContain('thread-fork-message');
    expect(html).toContain('aria-label="Fork from this message"');
    expect(html).not.toContain('thread-add-to-chat');
    expect(html).not.toContain('Add to chat');
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
    expect(user).not.toContain('thread-add-to-chat');
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

  it('wires copy and fork through the live thread view', () => {
    const detail = readFileSync(fileURLToPath(new URL('../../../views/threads/ThreadDetailView.tsx', import.meta.url)), 'utf8');
    expect(detail).toContain('void copyText(text);');
    expect(detail).toContain('product.threads.fork(threadId, sourceSeqEnd');
    const bar = readFileSync(fileURLToPath(new URL('./MessageActionBar.tsx', import.meta.url)), 'utf8');
    expect(bar).toContain('onCopy(text)');
    expect(bar).not.toContain('dispatchComposerQuote');
    expect(bar).not.toContain('Add to chat');
    expect(bar).toContain('onFork(sourceSeqEnd)');
    const composer = readFileSync(fileURLToPath(new URL('../../ThreadCommandComposer.tsx', import.meta.url)), 'utf8');
    expect(composer).not.toContain('COMPOSER_INSERT_EVENT');
    const row = readFileSync(fileURLToPath(new URL('./ConversationRow.tsx', import.meta.url)), 'utf8');
    expect(row).toContain('showFork={row.role === \'assistant\'}');
    expect(row).toContain('canEditConversationMessage(row, threadIdle)');
    expect(row).toContain('product.threads.createQueuedMessage(parentThreadId, { text })');
    expect(row).not.toContain('<SecondaryPanelSelectionActions');
  });
});
