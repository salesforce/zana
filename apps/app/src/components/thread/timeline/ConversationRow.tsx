import { Copy } from 'lucide-react';
import { MarkdownContent } from '../../MarkdownContent.js';
import type { ThreadTimelineViewRow } from '@zana-ai/zcc-thread-view';
import { mentionPillLabel } from './mention-pills.js';

export function ConversationRow({
  row,
  onCopy
}: {
  row: Extract<ThreadTimelineViewRow, { kind: 'conversation' }>;
  onCopy?: (text: string) => void;
}) {
  const testId = row.role === 'assistant' ? 'thread-assistant-text' : 'thread-user-text';
  const mentions = row.role === 'user' ? row.mentions : [];
  const text = row.text?.trim() ?? '';
  return (
    <article
      className={`thread-timeline-row is-${row.role}`}
      data-testid={testId}
      data-row-id={row.id}
    >
      <div className="thread-timeline-bubble">
        {mentions.length > 0 ? (
          <div className="thread-mention-pills">
            {mentions.map((mention, index) => (
              <span key={`${mention.start}-${index}`} className="thread-mention-pill">
                {mentionPillLabel(mention)}
              </span>
            ))}
          </div>
        ) : null}
        {text ? <MarkdownContent text={row.text} /> : null}
      </div>
      {text && onCopy ? (
        <div className="thread-message-actions">
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
        </div>
      ) : null}
    </article>
  );
}
