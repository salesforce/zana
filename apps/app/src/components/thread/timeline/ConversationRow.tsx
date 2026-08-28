import { memo, useMemo, useState, useSyncExternalStore } from 'react';
import { MarkdownContent } from '../../MarkdownContent.js';
import type { ThreadTimelineViewRow } from '@zana-ai/zcc-thread-view';
import { mentionPillLabel } from './mention-pills.js';
import { PluginMarkdownDirectives } from '../../../plugins/PluginMarkdownDirectives.js';
import { PluginSlotBoundary } from '../../../plugins/PluginSlotBoundary.js';
import { listMessageActions, subscribePluginSlots } from '../../../plugins/plugin-slots.js';
import { openPluginThreadPanel } from '../../../plugins/plugin-thread-panel.js';
import { ComposerImageThumbs, type ComposerImageThumb } from '../../composer/ComposerImageThumbs.js';
import { conversationImageSrc } from '../../../lib/prompt-attachments.js';
import { splitStreamingMarkdown } from './streaming-markdown-split.js';
import {
  canEditConversationMessage,
  MessageActionBar,
  MESSAGE_OVERFLOW_CAP,
  visibleMessageText
} from './MessageActionBar.js';
import { resolveIcon } from '../../../lib/resolveIcon.js';
import { product } from '../../../lib/product-client.js';
import { SecondaryPanelSelectionActions } from '../secondary-panel/SecondaryPanelSelectionActions.js';
import { conversationFilePreviewPaths } from '../../markdown-local-file.js';
import { dispatchThreadOpenFile } from '../secondary-panel/useThreadOpenFileSignal.js';
import { ThreadOpenFilePreviewButton } from './TimelineTitleView.js';
import { ThreadImageLightbox } from './ThreadImageLightbox.js';

function userRequestLabel(row: Extract<ThreadTimelineViewRow, { kind: 'conversation' }>): string | null {
  if (row.role !== 'user') return null;
  if (row.systemMessageKind !== 'unlabeled') {
    return row.systemMessageKind.replace(/-/g, ' ');
  }
  const request = row.turnRequest;
  if (request.kind === 'steer') return request.status === 'rejected' ? 'Steer rejected' : 'Steer';
  if (request.status === 'pending') return 'Pending';
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
  onFork
}: {
  row: Extract<ThreadTimelineViewRow, { kind: 'conversation' }>;
  onCopy?: (text: string) => void;
  threadId?: string;
  projectId?: string | null;
  parentThreadId?: string | null;
  threadIdle?: boolean;
  streaming?: boolean;
  onFork?: (sourceSeqEnd?: number) => void;
}) {
  const testId = row.role === 'assistant' ? 'thread-assistant-text' : 'thread-user-text';
  const mentions = row.role === 'user' ? row.mentions : [];
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.text ?? '');
  const [saving, setSaving] = useState(false);
  const [lightbox, setLightbox] = useState<ComposerImageThumb | null>(null);
  const text = row.text?.trim() ?? '';
  const visibleText = visibleMessageText(row.text ?? '', expanded);
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
  const fileNames = row.role === 'user' ? (row.attachments?.localFilePaths ?? []) : [];
  const previewPaths = useMemo(
    () => conversationFilePreviewPaths(row.text ?? '', fileNames),
    [fileNames, row.text]
  );
  const actions = useSyncExternalStore(subscribePluginSlots, listMessageActions, listMessageActions);
  const streamingSplit = useMemo(
    () => (streaming && row.role === 'assistant' ? splitStreamingMarkdown(row.text ?? '') : null),
    [row.role, row.text, streaming]
  );
  const requestLabel = userRequestLabel(row);
  const pluginActions = actions.map((action) => {
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
  });
  return (
    <article
      className={`thread-timeline-row is-${row.role}`}
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
          {imageThumbs.length > 0 ? (
            <ComposerImageThumbs images={imageThumbs} onOpen={setLightbox} />
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
                onChange={(event) => setDraft(event.target.value)}
              />
              <button type="submit" disabled={saving}>Save</button>
              <button type="button" onClick={() => { setEditing(false); setDraft(row.text ?? ''); }}>
                Cancel
              </button>
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
                      text={streamingSplit.tail}
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
            || ((row.text ?? '').length > MESSAGE_OVERFLOW_CAP && !editing) ? (
            <div className="thread-message-overflow-row">
              {threadId && previewPaths.length > 0 && !editing ? (
                previewPaths.map((path) => (
                  <ThreadOpenFilePreviewButton
                    key={path}
                    onClick={() => dispatchThreadOpenFile(threadId, path)}
                  />
                ))
              ) : null}
              {(row.text ?? '').length > MESSAGE_OVERFLOW_CAP && !editing ? (
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
      <MessageActionBar
        text={text}
        threadId={threadId}
        sourceSeqEnd={row.sourceSeqEnd}
        onCopy={onCopy}
        onEdit={canEditConversationMessage(row, threadIdle) ? () => {
          setDraft(row.text ?? '');
          setEditing(true);
        } : undefined}
        onSendToMain={row.role === 'assistant' && parentThreadId ? () => {
          void product.threads.createQueuedMessage(parentThreadId, { text });
        } : undefined}
        onFork={onFork}
        showFork={row.role === 'assistant'}
        pluginActions={pluginActions}
      />
      {lightbox ? (
        <ThreadImageLightbox
          src={lightbox.src}
          alt={lightbox.name}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </article>
  );
});
