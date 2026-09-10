import { memo, useMemo, useState, useSyncExternalStore } from 'react';
import { MarkdownContent } from '../../MarkdownContent.js';
import type { ThreadTimelineViewRow } from '@zana-ai/zcc-thread-view';
import { mentionPillLabel } from './mention-pills.js';
import { PluginMarkdownDirectives } from '../../../plugins/PluginMarkdownDirectives.js';
import { PluginSlotBoundary } from '../../../plugins/PluginSlotBoundary.js';
import { listMessageActions, subscribePluginSlots } from '../../../plugins/plugin-slots.js';
import { openPluginThreadPanel } from '../../../plugins/plugin-thread-panel.js';
import { conversationImageSrc } from '../../../lib/prompt-attachments.js';
import { extractInlineThreadImages, threadImageStubLabel } from './thread-inline-images.js';
import { ThreadDisplayedImage } from './ThreadDisplayedImage.js';
import { splitStreamingMarkdown } from './streaming-markdown-split.js';
import { repairStreamingMarkdownTail } from './repair-streaming-markdown-tail.js';
import {
  canEditConversationMessage,
  MessageActionBar,
  MESSAGE_OVERFLOW_CAP,
  visibleMessageText
} from './MessageActionBar.js';
import { resolveIcon } from '../../../lib/resolveIcon.js';
import { product } from '../../../lib/product-client.js';
import { SecondaryPanelSelectionActions, readTrimmedSelection } from '../secondary-panel/SecondaryPanelSelectionActions.js';
import type { ThreadChatMessageAction } from '@zana-ai/zcc-plugin-sdk/app';
import { conversationFilePreviewPaths } from '../../markdown-local-file.js';
import { dispatchThreadOpenFile } from '../secondary-panel/useThreadOpenFileSignal.js';
import { ThreadOpenFilePreviewButton } from './TimelineTitleView.js';
import { ThreadImageLightbox } from './ThreadImageLightbox.js';
import { PlanExecutionCard } from './PlanExecutionCard.js';
import type { PlanExecutionTask } from './plan-execution-card.js';

function userRequestLabel(row: Extract<ThreadTimelineViewRow, { kind: 'conversation' }>): string | null {
  if (row.role !== 'user') return null;
  if (row.systemMessageKind !== 'unlabeled') {
    return row.systemMessageKind.replace(/-/g, ' ');
  }
  const request = row.turnRequest;
  if (request.kind === 'steer') return request.status === 'rejected' ? 'Steer rejected' : 'Steer';
  if (request.status === 'rejected') return 'Rejected';
  return null;
}

export const ConversationRow = memo(function ConversationRow({
  row,
  onCopy,
  threadId,
  projectId,
  parentThreadId,
  threadIdle = false,
  streaming = false,
  onFork,
  messageActions,
  includePluginMessageActions = true,
  planExecution
}: {
  row: Extract<ThreadTimelineViewRow, { kind: 'conversation' }>;
  onCopy?: (text: string) => void;
  threadId?: string;
  projectId?: string | null;
  parentThreadId?: string | null;
  threadIdle?: boolean;
  streaming?: boolean;
  onFork?: (sourceSeqEnd?: number) => void;
  messageActions?: readonly ThreadChatMessageAction[];
  includePluginMessageActions?: boolean;
  planExecution?: { title: string; tasks: readonly PlanExecutionTask[] } | null;
}) {
  const testId = row.role === 'assistant' ? 'thread-assistant-text' : 'thread-user-text';
  const mentions = row.role === 'user' ? row.mentions : [];
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.text ?? '');
  const [saving, setSaving] = useState(false);
  const [lightbox, setLightbox] = useState<{ src: string; name: string } | null>(null);
  const extracted = useMemo(() => extractInlineThreadImages(row.text ?? ''), [row.text]);
  const text = extracted.text.trim();
  const visibleText = visibleMessageText(extracted.text, expanded);
  const imageRefs = useMemo(() => {
    const refs: Array<{ id: string; name: string; path: string }> = [];
    const seen = new Set<string>();
    const push = (id: string, path: string, name: string) => {
      if (!path || seen.has(path)) return;
      seen.add(path);
      refs.push({ id, name, path });
    };
    if (row.role === 'user') {
      for (const [index, src] of (row.attachments?.imageUrls ?? []).entries()) {
        push(`url-${index}`, src, 'Attached image');
      }
      for (const [index, path] of (row.attachments?.localImagePaths ?? []).entries()) {
        push(`local-${index}`, path, path.split(/[\\/]/u).pop() ?? 'Attached image');
      }
    }
    for (const [index, image] of extracted.images.entries()) {
      push(`inline-${index}`, image.src, image.alt || threadImageStubLabel(image.src));
    }
    return refs;
  }, [extracted.images, row.attachments, row.role]);
  const fileNames = row.role === 'user' ? (row.attachments?.localFilePaths ?? []) : [];
  const previewPaths = useMemo(
    () => conversationFilePreviewPaths(row.text ?? '', fileNames),
    [fileNames, row.text]
  );
  const actions = useSyncExternalStore(subscribePluginSlots, listMessageActions, listMessageActions);
  const streamingSplit = useMemo(
    () => (streaming && row.role === 'assistant' ? splitStreamingMarkdown(extracted.text) : null),
    [extracted.text, row.role, streaming]
  );
  const streamingTail = streamingSplit
    ? repairStreamingMarkdownTail(streamingSplit.tail)
    : null;
  const requestLabel = userRequestLabel(row);
  const cancelEdit = () => {
    setEditing(false);
    setDraft(row.text ?? '');
  };
  const pluginActions = includePluginMessageActions
    ? actions.map((action) => {
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
            const selectedText = readTrimmedSelection() ?? undefined;
            void action.run({
              threadId: threadId ?? '',
              message: {
                id: row.id,
                threadId: threadId ?? '',
                role: row.role,
                text,
                sourceSeqEnd: row.sourceSeqEnd ?? 0
              },
              ...(selectedText ? { selectedText } : {}),
              openPanel(options) {
                return openPluginThreadPanel({
                  pluginId: action.pluginId,
                  threadId: threadId ?? null,
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
  })
    : [];
  const localActions = (messageActions ?? [])
    .filter((action) => !action.roles || action.roles.includes(row.role))
    .map((action) => {
      const Icon = action.icon ? resolveIcon(action.icon) : null;
      return (
        <button
          key={action.id}
          type="button"
          className="thread-message-action"
          data-testid={`thread-chat-message-action-${action.id}`}
          aria-label={action.title}
          title={action.title}
          onClick={() => {
            void action.run({
              id: row.id,
              threadId: threadId ?? '',
              role: row.role,
              text,
              sourceSeqEnd: row.sourceSeqEnd ?? 0
            });
          }}
        >
          {Icon ? <Icon size={12} /> : action.title}
        </button>
      );
    });
  return (
    <article
      className={`thread-timeline-row is-${row.role}${editing ? ' is-editing' : ''}`}
      data-testid={testId}
      data-row-id={row.id}
      data-streaming={streaming ? 'true' : undefined}
    >
      {requestLabel ? (
        <span className="thread-message-request-label" data-testid="thread-message-request-label">
          {requestLabel}
        </span>
      ) : null}
      <SecondaryPanelSelectionActions threadId={threadId}>
        <div className="thread-timeline-bubble">
          {imageRefs.length > 0 ? (
            <div className="composer-image-thumbs" aria-label="Attached images">
              {imageRefs.map((image) => {
                const readySrc = conversationImageSrc(projectId, image.path);
                return (
                  <div key={image.id} className="composer-image-thumb">
                    {readySrc ? (
                      <button
                        type="button"
                        className="composer-image-thumb-preview"
                        title={image.name}
                        onClick={() => setLightbox({ src: readySrc, name: image.name })}
                      >
                        <img src={readySrc} alt={image.name} loading="lazy" decoding="async" />
                      </button>
                    ) : (
                      <ThreadDisplayedImage
                        path={image.path}
                        threadId={threadId}
                        alt={image.name}
                        variant="thumb"
                        onOpen={(src, name) => setLightbox({ src, name })}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}
          {fileNames.length > 0 ? (
            <ul className="thread-message-files">
              {fileNames.map((path, index) => (
                <li key={`${index}:${path}`}>
                  {threadId ? (
                    <button
                      type="button"
                      className="thread-message-file"
                      onClick={() => dispatchThreadOpenFile(threadId, path)}
                    >
                      {path.split(/[\\/]/u).pop() ?? path}
                    </button>
                  ) : (
                    path.split(/[\\/]/u).pop() ?? path
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          {mentions.length > 0 ? (
            <div className="thread-mention-pills">
              {mentions.map((mention, index) => (
                <span key={`${mention.start}-${index}`} className="thread-mention-pill">
                  {mentionPillLabel(mention)}
                </span>
              ))}
            </div>
          ) : null}
          {editing ? (
            <form
              className="thread-message-edit"
              data-testid="thread-message-edit"
              onSubmit={(event) => {
                event.preventDefault();
                if (!threadId || saving) return;
                setSaving(true);
                void product.threads.editMessage(threadId, {
                  operationId: row.id,
                  expectedRequestSequence: row.sourceSeqStart,
                  input: [{ type: 'text', text: draft, mentions: [] }]
                }).then(() => setEditing(false)).finally(() => setSaving(false));
              }}
            >
              <textarea
                value={draft}
                aria-label="Edit message"
                autoFocus
                disabled={saving}
                rows={3}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    cancelEdit();
                    return;
                  }
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <div className="thread-message-edit-actions">
                <button type="button" className="btn" disabled={saving} onClick={cancelEdit}>
                  Cancel
                </button>
                <button type="submit" className="btn primary" disabled={saving}>Save</button>
              </div>
            </form>
          ) : text ? (
            row.role === 'assistant' ? (
              streamingSplit ? (
                <>
                  <PluginMarkdownDirectives
                    text={streamingSplit.settled}
                    threadId={threadId}
                    projectId={projectId}
                    messageId={row.id}
                    threadMentions
                  />
                  <div className="thread-timeline-streaming-tail" data-testid="thread-streaming-tail">
                    <PluginMarkdownDirectives
                      text={streamingTail ?? streamingSplit.tail}
                      threadId={threadId}
                      projectId={projectId}
                      messageId={`${row.id}:tail`}
                      threadMentions
                    />
                  </div>
                </>
              ) : (
                <PluginMarkdownDirectives
                  text={visibleText}
                  threadId={threadId}
                  projectId={projectId}
                  messageId={row.id}
                  threadMentions
                />
              )
            ) : (
              <MarkdownContent text={visibleText} breaks threadId={threadId} projectId={projectId} />
            )
          ) : null}
          {(threadId && previewPaths.length > 0 && !editing)
            || (extracted.text.length > MESSAGE_OVERFLOW_CAP && !editing) ? (
            <div className="thread-message-overflow-row">
              {threadId && previewPaths.length > 0 && !editing ? (
                previewPaths.map((path) => (
                  <ThreadOpenFilePreviewButton
                    key={path}
                    onClick={() => dispatchThreadOpenFile(threadId, path)}
                  />
                ))
              ) : null}
              {extracted.text.length > MESSAGE_OVERFLOW_CAP && !editing ? (
                <button
                  type="button"
                  className="thread-message-overflow"
                  data-testid="thread-message-overflow"
                  onClick={() => setExpanded((value) => !value)}
                >
                  {expanded ? 'Show less' : 'Show more'}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </SecondaryPanelSelectionActions>
      {editing ? null : (
        <MessageActionBar
          text={text}
          threadId={threadId}
          sourceSeqEnd={row.sourceSeqEnd}
          onCopy={onCopy}
          onEdit={canEditConversationMessage(row, threadIdle) ? () => {
            setDraft(row.text ?? '');
            setEditing(true);
          } : undefined}
          onSendToMain={row.role === 'assistant' && parentThreadId && includePluginMessageActions ? () => {
            void product.threads.createQueuedMessage(parentThreadId, { text });
          } : undefined}
          onFork={onFork}
          showFork={row.role === 'assistant'}
          pluginActions={[...localActions, ...pluginActions]}
        />
      )}
      {lightbox ? (
        <ThreadImageLightbox
          src={lightbox.src}
          alt={lightbox.name}
          onClose={() => setLightbox(null)}
        />
      ) : null}
      {row.role === 'user' && planExecution && planExecution.tasks.length > 0 ? (
        <PlanExecutionCard title={planExecution.title} tasks={planExecution.tasks} />
      ) : null}
    </article>
  );
});
