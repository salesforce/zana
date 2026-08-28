import { Copy } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { MarkdownContent } from '../../MarkdownContent.js';
import type { ThreadTimelineViewRow } from '@zana-ai/zcc-thread-view';
import { mentionPillLabel } from './mention-pills.js';
import { PluginMarkdownDirectives } from '../../../plugins/PluginMarkdownDirectives.js';
import { PluginSlotBoundary } from '../../../plugins/PluginSlotBoundary.js';
import { listMessageActions, subscribePluginSlots } from '../../../plugins/plugin-slots.js';
import { openPluginThreadPanel } from '../../../plugins/plugin-thread-panel.js';
import { ComposerImageThumbs } from '../../composer/ComposerImageThumbs.js';
import { conversationImageSrc } from '../../../lib/prompt-attachments.js';

export function ConversationRow({
  row,
  onCopy,
  threadId,
  projectId
}: {
  row: Extract<ThreadTimelineViewRow, { kind: 'conversation' }>;
  onCopy?: (text: string) => void;
  threadId?: string;
  projectId?: string | null;
}) {
  const testId = row.role === 'assistant' ? 'thread-assistant-text' : 'thread-user-text';
  const mentions = row.role === 'user' ? row.mentions : [];
  const text = row.text?.trim() ?? '';
  const imageThumbs = row.role === 'user'
    ? [
        ...(row.attachments?.imageUrls ?? []).map((src, index) => ({
          id: `url-${index}`,
          name: 'Attached image',
          src
        })),
        ...(row.attachments?.localImagePaths ?? []).flatMap((path, index) => {
          const src = conversationImageSrc(projectId, path);
          return src ? [{ id: `local-${index}`, name: path.split(/[\\/]/u).pop() ?? 'Attached image', src }] : [];
        })
      ]
    : [];
  const actions = useSyncExternalStore(subscribePluginSlots, listMessageActions, listMessageActions);
  return (
    <article
      className={`thread-timeline-row is-${row.role}`}
      data-testid={testId}
      data-row-id={row.id}
    >
      <div className="thread-timeline-bubble">
        {imageThumbs.length > 0 ? <ComposerImageThumbs images={imageThumbs} /> : null}
        {mentions.length > 0 ? (
          <div className="thread-mention-pills">
            {mentions.map((mention, index) => (
              <span key={`${mention.start}-${index}`} className="thread-mention-pill">
                {mentionPillLabel(mention)}
              </span>
            ))}
          </div>
        ) : null}
        {text ? (
          row.role === 'assistant' ? (
            <PluginMarkdownDirectives
              text={row.text ?? ''}
              threadId={threadId}
              projectId={projectId}
              messageId={row.id}
            />
          ) : (
            <MarkdownContent text={row.text} />
          )
        ) : null}
      </div>
      {text && (onCopy || actions.length > 0) ? (
        <div className="thread-message-actions">
          {onCopy ? (
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
          {actions.map((action) => {
            const Icon = action.icon ? resolveIcon(action.icon) : null;
            return (
              <PluginSlotBoundary
                key={`${action.pluginId}/${action.id}:${action.generation}`}
                pluginId={action.pluginId}
                generation={action.generation}
              >
                <button
                  type="button"
                  className="thread-message-action"
                  aria-label={action.title}
                  title={action.title}
                  onClick={() => {
                    void action.run({
                      threadId: threadId ?? '',
                      message: {
                        id: row.id,
                        threadId: threadId ?? '',
                        role: row.role,
                        text,
                        sourceSeqEnd: row.sourceSeqEnd ?? 0
                      },
                      openPanel(options) {
                        return openPluginThreadPanel({
                          pluginId: action.pluginId,
                          threadId,
                          actionId: options.actionId,
                          title: options.title,
                          params: options.params ?? null
                        });
                      }
                    });
                  }}
                >
                  {Icon ? <Icon size={12} /> : action.title}
                </button>
              </PluginSlotBoundary>
            );
          })}
        </div>
      ) : null}
    </article>
  );
}
