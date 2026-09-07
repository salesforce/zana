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
          fork: vi.fn(async () => ({ ok: true })),
          hostFileContent: vi.fn(async () => ({
            content: 'abc',
            encoding: 'base64',
            contentType: 'image/png'
          }))
        }
      }
    }));

const pluginMessageActions = vi.hoisted(() => ({
  current: [] as Array<{
    pluginId: string;
    id: string;
    title: string;
    generation: number;
    run: (context: {
      threadId: string;
      message: { text: string };
      selectedText?: string;
      openPanel: (options: { actionId: string }) => boolean;
    }) => void;
  }>
}));

const EMPTY_DIRECTIVES: unknown[] = [];

vi.mock('../../../plugins/plugin-slots.js', () => ({
  subscribePluginSlots: (listener: () => void) => {
    listener();
    return () => undefined;
  },
  listMessageActions: () => pluginMessageActions.current,
  listMessageDirectives: () => EMPTY_DIRECTIVES
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

const assistantRow = {
  ...userRow,
  id: 'a-1',
  role: 'assistant' as const,
  text: 'whole message text',
  sourceSeqEnd: 42,
  initiator: 'agent' as const,
  mentions: undefined
};

describe('ConversationRow plugin message actions', () => {
  afterEach(() => {
    cleanup();
    pluginMessageActions.current = [];
    vi.unstubAllGlobals();
  });

  it('passes selectedText when the host has a selection', () => {
    const run = vi.fn();
    pluginMessageActions.current = [{
      pluginId: 'demo',
      id: 'reply',
      title: 'Reply in side chat',
      generation: 1,
      run
    }];
    vi.stubGlobal('getSelection', () => ({ toString: () => 'just this part' }));
    render(
      <ConversationRow
        threadId="t1"
        threadIdle
        onCopy={() => undefined}
        row={assistantRow}
      />
    );
    fireEvent.click(screen.getByLabelText('Reply in side chat'));
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      selectedText: 'just this part',
      message: expect.objectContaining({ text: 'whole message text', sourceSeqEnd: 42 })
    }));
  });

  it('hides plugin message actions when includePluginMessageActions is false', () => {
    pluginMessageActions.current = [{
      pluginId: 'demo',
      id: 'reply',
      title: 'Reply in side chat',
      generation: 1,
      run: vi.fn()
    }];
    render(
      <ConversationRow
        threadId="t1"
        threadIdle
        onCopy={() => undefined}
        row={assistantRow}
        includePluginMessageActions={false}
        messageActions={[{
          id: 'send-to-main',
          title: 'Send to main thread',
          roles: ['assistant'],
          run: () => undefined
        }]}
      />
    );
    expect(screen.queryByLabelText('Reply in side chat')).toBeNull();
    expect(screen.getByTestId('thread-chat-message-action-send-to-main')).toBeTruthy();
  });

  it('opens an attached image in a modal', () => {
    render(
      <ConversationRow
        projectId="proj-1"
        onCopy={() => undefined}
        row={{
          ...userRow,
          id: 'u-img',
          text: '',
          attachments: {
            webImages: 0,
            localImages: 1,
            localFiles: 0,
            imageUrls: [],
            localImagePaths: ['shot-1.png'],
            localFilePaths: []
          }
        }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'shot-1.png' }));
    const dialog = screen.getByRole('dialog', { name: 'shot-1.png' });
    expect(dialog.className).toContain('thread-image-modal');
    expect(dialog.querySelector('img')?.getAttribute('src'))
      .toContain('/api/v1/projects/proj-1/attachments/content?path=shot-1.png');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'shot-1.png' })).toBeNull();
  });

  it('opens a markdown image in a modal', () => {
    render(
      <ConversationRow
        onCopy={() => undefined}
        row={{
          ...userRow,
          text: '![cat](https://example.com/cat.png)'
        }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'View cat' }));
    expect(screen.getByRole('dialog', { name: 'cat' })).toBeTruthy();
    expect(screen.getByRole('dialog').querySelector('img')?.getAttribute('src'))
      .toBe('https://example.com/cat.png');
  });
});

describe('ConversationRow request labels', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not label an in-flight first message as Pending', () => {
    render(
      <ConversationRow
        onCopy={() => undefined}
        row={{
          ...userRow,
          turnRequest: { isGrouped: false, kind: 'message', status: 'pending' }
        }}
      />
    );
    expect(screen.queryByTestId('thread-message-request-label')).toBeNull();
  });

  it('labels a rejected message and a steer', () => {
    const { rerender } = render(
      <ConversationRow
        onCopy={() => undefined}
        row={{
          ...userRow,
          turnRequest: { isGrouped: false, kind: 'message', status: 'rejected' }
        }}
      />
    );
    expect(screen.getByTestId('thread-message-request-label').textContent).toBe('Rejected');
    rerender(
      <ConversationRow
        onCopy={() => undefined}
        row={{
          ...userRow,
          turnRequest: { isGrouped: false, kind: 'steer', status: 'pending' }
        }}
      />
    );
    expect(screen.getByTestId('thread-message-request-label').textContent).toBe('Steer');
    rerender(
      <ConversationRow
        onCopy={() => undefined}
        row={{
          ...userRow,
          turnRequest: { isGrouped: false, kind: 'steer', status: 'rejected' }
        }}
      />
    );
    expect(screen.getByTestId('thread-message-request-label').textContent).toBe('Steer rejected');
  });
});
