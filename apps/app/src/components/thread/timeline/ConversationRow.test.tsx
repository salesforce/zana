/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationRow } from './ConversationRow.js';

const editMessage = vi.fn(async (_threadId: string, _body: unknown) => ({ ok: true }));

vi.mock('../../../lib/product-client.js', () => ({
  product: {
    threads: {
      editMessage: (threadId: string, body: unknown) => editMessage(threadId, body),
      createQueuedMessage: vi.fn(async () => ({ ok: true })),
      fork: vi.fn(async () => ({ ok: true }))
    }
  }
}));

const userRow = {
  threadId: 't1',
  turnId: 'turn-1',
  sourceSeqStart: 1,
  sourceSeqEnd: 1,
  startedAt: 1,
  createdAt: 1,
  id: 'u-edit',
  kind: 'conversation' as const,
  role: 'user' as const,
  text: 'hello',
  attachments: null,
  initiator: 'user' as const,
  senderThreadId: null,
  systemMessageKind: 'unlabeled' as const,
  systemMessageSubject: null,
  turnRequest: { isGrouped: false, kind: 'message' as const, status: 'accepted' as const },
  mentions: []
};

describe('ConversationRow message edit', () => {
  afterEach(() => {
    cleanup();
    editMessage.mockClear();
  });

  it('opens a themed editor and hides the hover action icons', () => {
    render(
      <ConversationRow
        threadId="t1"
        threadIdle
        onCopy={() => undefined}
        row={userRow}
      />
    );
    expect(screen.queryByTestId('thread-message-edit')).toBeNull();
    fireEvent.click(screen.getByTestId('thread-edit-message'));
    const form = screen.getByTestId('thread-message-edit');
    expect(form.className).toBe('thread-message-edit');
    expect(form.querySelector('.thread-message-edit-actions')).not.toBeNull();
    expect(form.querySelector('button.btn.primary')?.textContent).toBe('Save');
    expect(form.querySelector('button.btn:not(.primary)')?.textContent).toBe('Cancel');
    expect((screen.getByLabelText('Edit message') as HTMLTextAreaElement).value).toBe('hello');
    expect(screen.getByTestId('thread-user-text').className).toContain('is-editing');
    expect(screen.queryByTestId('thread-message-action-bar')).toBeNull();
    expect(screen.queryByTestId('thread-edit-message')).toBeNull();
  });

  it('cancels with Escape and restores the original text', () => {
    render(
      <ConversationRow
        threadId="t1"
        threadIdle
        onCopy={() => undefined}
        row={userRow}
      />
    );
    fireEvent.click(screen.getByTestId('thread-edit-message'));
    const textarea = screen.getByLabelText('Edit message') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'changed' } });
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(screen.queryByTestId('thread-message-edit')).toBeNull();
    expect(screen.getByTestId('thread-edit-message')).toBeTruthy();
    fireEvent.click(screen.getByTestId('thread-edit-message'));
    expect((screen.getByLabelText('Edit message') as HTMLTextAreaElement).value).toBe('hello');
  });

  it('cancels from the Cancel button', () => {
    render(
      <ConversationRow
        threadId="t1"
        threadIdle
        onCopy={() => undefined}
        row={userRow}
      />
    );
    fireEvent.click(screen.getByTestId('thread-edit-message'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('thread-message-edit')).toBeNull();
    expect(screen.getByTestId('thread-edit-message')).toBeTruthy();
  });

  it('saves with Cmd+Enter', async () => {
    render(
      <ConversationRow
        threadId="t1"
        threadIdle
        onCopy={() => undefined}
        row={userRow}
      />
    );
    fireEvent.click(screen.getByTestId('thread-edit-message'));
    fireEvent.change(screen.getByLabelText('Edit message'), { target: { value: 'from keyboard' } });
    fireEvent.keyDown(screen.getByLabelText('Edit message'), { key: 'Enter', metaKey: true });
    await waitFor(() => {
      expect(editMessage).toHaveBeenCalledWith('t1', expect.objectContaining({
        input: [{ type: 'text', text: 'from keyboard', mentions: [] }]
      }));
    });
  });

  it('saves the draft through editMessage', async () => {
    render(
      <ConversationRow
        threadId="t1"
        threadIdle
        onCopy={() => undefined}
        row={userRow}
      />
    );
    fireEvent.click(screen.getByTestId('thread-edit-message'));
    fireEvent.change(screen.getByLabelText('Edit message'), { target: { value: 'updated hello' } });
    fireEvent.submit(screen.getByTestId('thread-message-edit'));
    await waitFor(() => {
      expect(editMessage).toHaveBeenCalledWith('t1', {
        operationId: 'u-edit',
        expectedRequestSequence: 1,
        input: [{ type: 'text', text: 'updated hello', mentions: [] }]
      });
    });
    await waitFor(() => {
      expect(screen.queryByTestId('thread-message-edit')).toBeNull();
    });
  });
});
