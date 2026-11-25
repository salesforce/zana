import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Archive, ArchiveRestore, Copy, Ellipsis, FolderInput, Mail, MailOpen, Pencil, Pin, PinOff } from 'lucide-react';
import { copyTextOrFail } from '../../lib/copy-text.js';
import { product } from '../../lib/product-client.js';
import { useSessionMove } from '../../lib/session-move.js';
import { withRunningProcessWarning } from '../../lib/thread-running-processes.js';
import { isUnreadThread } from '../../lib/unread-threads.js';
import { errorMessage, useUi } from '../../store.js';
import { useThreads, type ThreadListItem } from '../../thread-store.js';
import { PromptModal } from '../PromptModal.js';
import { ThreadToolMenu, type ThreadToolMenuItem } from '../thread/secondary-panel/ThreadToolMenu.js';
import { renameThread, upsertReturnedThread } from '../threadCardActions.js';

export function BasicConversationRowActions({ thread, title, onArchive, children }: {
  thread: ThreadListItem;
  title: string;
  onArchive(thread: ThreadListItem): Promise<void>;
  children: ReactNode;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [pending, setPending] = useState(false);
  const close = useCallback((restoreFocus: boolean) => {
    if (restoreFocus) anchor?.focus();
    setAnchor(null);
  }, [anchor]);
  const label = `Actions for ${title}`;
  const { id, archivedAt } = thread;
  const pinned = thread.pinnedAt != null;
  const unread = isUnreadThread(thread);

  const run = async (failure: string, action: () => Promise<unknown>) => {
    setPending(true);
    try {
      await action();
    } catch (error) {
      useUi.getState().pushToast(errorMessage(error, failure), 'error');
    } finally {
      setPending(false);
    }
  };
  const copy: ThreadToolMenuItem = {
    id: 'copy', label: 'Copy conversation ID', icon: <Copy aria-hidden="true" />,
    run: () => void run('Could not copy conversation ID', async () => {
      await copyTextOrFail(id);
      useUi.getState().pushToast('Conversation ID copied');
    })
  };
  const items: ThreadToolMenuItem[] = archivedAt ? [copy, {
    id: 'restore', label: 'Restore', icon: <ArchiveRestore aria-hidden="true" />, separatorBefore: true,
    run: () => void run('Could not restore conversation', async () => {
      upsertReturnedThread(await product.threads.unarchive(id));
    })
  }] : [{
    id: 'pin', label: pinned ? 'Unpin' : 'Pin', icon: pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />,
    run: () => void run('Could not update conversation pin', async () => {
      upsertReturnedThread(await (pinned ? product.threads.unpin(id) : product.threads.pin(id)));
    })
  }, {
    id: 'rename', label: 'Rename', icon: <Pencil aria-hidden="true" />,
    run: () => setRenaming(true)
  }, {
    id: 'move', label: 'Move to project…', icon: <FolderInput aria-hidden="true" />,
    run: () => useSessionMove.getState().open(id)
  }, {
    id: 'read', label: unread ? 'Mark as read' : 'Mark as unread', icon: unread ? <MailOpen aria-hidden="true" /> : <Mail aria-hidden="true" />,
    run: () => void run('Could not update conversation read status', async () => {
      upsertReturnedThread(await (unread ? product.threads.read(id) : product.threads.unread(id)));
    })
  }, { ...copy, separatorBefore: true }, {
    id: 'archive', label: 'Archive', icon: <Archive aria-hidden="true" />, separatorBefore: true,
    run: () => {
      const current = useThreads.getState().threads.find(row => row.id === id) ?? thread;
      if (window.confirm(withRunningProcessWarning(`Archive “${title}”?`, current))) {
        void run('Could not archive conversation', () => onArchive(current));
      }
    }
  }];

  return <div className="basic-ui-chat-item" onContextMenu={event => {
    if (pending) return;
    event.preventDefault();
    setAnchor(trigger.current);
  }}>
    {children}
    <button ref={trigger} type="button" className="basic-ui-chat-actions basic-ui-conversation-menu-button"
      aria-label={label} title={label} aria-haspopup="menu" aria-expanded={Boolean(anchor)} disabled={pending}
      onClick={event => setAnchor(anchor ? null : event.currentTarget)}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' && !anchor) {
          event.preventDefault();
          setAnchor(event.currentTarget);
        }
      }}>
      <Ellipsis size={16} aria-hidden="true" />
    </button>
    {anchor && <ThreadToolMenu anchor={anchor} label={label} items={items} onClose={close} hideTitle />}
    {renaming && <PromptModal title="Rename conversation" label="Title" initialValue={thread.title ?? ''}
      confirmLabel="Rename" onClose={() => setRenaming(false)} onSubmit={next => {
        setRenaming(false);
        void run('Could not rename conversation', () => renameThread(thread, next, { rename: product.threads.rename }));
      }} />}
  </div>;
}
