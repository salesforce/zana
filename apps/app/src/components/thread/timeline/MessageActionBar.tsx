import { Copy, CornerUpLeft, GitFork, MessageSquarePlus, Pencil } from 'lucide-react';
import type { ReactNode } from 'react';
import { product } from '../../../lib/product-client.js';
import { dispatchComposerQuote } from '../secondary-panel/SecondaryPanelSelectionActions.js';

export function MessageActionBar({
  text,
  threadId,
  sourceSeqEnd,
  onCopy,
  onEdit,
  onSendToMain,
  onFork,
  showFork = false,
  pluginActions
}: {
  text: string;
  threadId?: string;
  sourceSeqEnd?: number;
  onCopy?: (text: string) => void;
  onEdit?: () => void;
  onSendToMain?: () => void;
  onFork?: (sourceSeqEnd?: number) => void;
  showFork?: boolean;
  pluginActions?: ReactNode;
}) {
  if (!text && !pluginActions && !onEdit && !onSendToMain && !showFork) return null;
  return (
    <div className="thread-message-actions" data-testid="thread-message-action-bar">
      {onCopy && text ? (
        <button
          type="button"
          className="thread-message-action"
          aria-label="Copy message"
          title="Copy"
          data-testid="thread-copy-message"
          onClick={() => onCopy(text)}
        >
          <Copy size={12} />
        </button>
      ) : null}
      {onEdit ? (
        <button
          type="button"
          className="thread-message-action"
          aria-label="Edit message"
          title="Edit"
          data-testid="thread-edit-message"
          onClick={onEdit}
        >
          <Pencil size={12} />
        </button>
      ) : null}
      {threadId && text ? (
        <button
          type="button"
          className="thread-message-action"
          aria-label="Add to chat"
          title="Add to chat"
          data-testid="thread-add-to-chat"
          onClick={() => {
            const selected = typeof window !== 'undefined'
              ? window.getSelection()?.toString().trim() ?? ''
              : '';
            dispatchComposerQuote(threadId, selected || text);
          }}
        >
          <MessageSquarePlus size={12} />
        </button>
      ) : null}
      {onSendToMain && text ? (
        <button
          type="button"
          className="thread-message-action"
          aria-label="Send to main thread"
          title="Send to main"
          data-testid="thread-send-to-main"
          onClick={onSendToMain}
        >
          <CornerUpLeft size={12} />
        </button>
      ) : null}
      {showFork && threadId ? (
        <button
          type="button"
          className="thread-message-action"
          aria-label="Fork from this message"
          title="Fork"
          data-testid="thread-fork-message"
          onClick={() => {
            if (onFork) {
              onFork(sourceSeqEnd);
              return;
            }
            void product.threads.fork(threadId, sourceSeqEnd != null ? { sourceSeqEnd } : undefined);
          }}
        >
          <GitFork size={12} />
        </button>
      ) : null}
      {pluginActions}
    </div>
  );
}

export const MESSAGE_OVERFLOW_CAP = 2000;

export function visibleMessageText(text: string, expanded: boolean, cap = MESSAGE_OVERFLOW_CAP): string {
  if (expanded || text.length <= cap) return text;
  return `${text.slice(0, cap).trimEnd()}…`;
}

export function canEditConversationMessage(
  row: { role: string; turnRequest: { kind: string; status: string } | null },
  threadIdle: boolean
): boolean {
  return (
    threadIdle
    && row.role === 'user'
    && row.turnRequest?.kind === 'message'
    && row.turnRequest.status === 'accepted'
  );
}
