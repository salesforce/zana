import { Copy } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { MarkdownContent } from '../../MarkdownContent.js';
import type { ThreadTimelineViewRow } from '@zana-ai/zcc-thread-view';
import { mentionPillLabel } from './mention-pills.js';
import { PluginMarkdownDirectives } from '../../../plugins/PluginMarkdownDirectives.js';
import { PluginSlotBoundary } from '../../../plugins/PluginSlotBoundary.js';
import { listMessageActions, listThreadPanelActions, subscribePluginSlots } from '../../../plugins/plugin-slots.js';
import { addClosableTab, loadSecondaryPanelState, persistSecondaryPanelState } from '../secondary-panel/threadSecondaryPanelState.js';
import { resolveIcon } from '../../../lib/resolveIcon.js';

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
  const actions = useSyncExternalStore(subscribePluginSlots, listMessageActions, listMessageActions);
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
                        if (!threadId) return false;
                        const panelAction = listThreadPanelActions().find(
                          (rowAction) =>
                            rowAction.pluginId === action.pluginId && rowAction.id === options.actionId
                        );
                        if (!panelAction) return false;
                        const state = loadSecondaryPanelState(threadId);
                        persistSecondaryPanelState(
                          threadId,
                          addClosableTab(state, {
                            kind: 'plugin',
                            title: options.title ?? panelAction.title,
                            moduleId: action.pluginId,
                            actionId: options.actionId,
                            params: options.params ?? null,
                            layout: panelAction.layout
                          })
                        );
                        window.dispatchEvent(
                          new CustomEvent('zcc:secondary-panel-changed', { detail: { threadId } })
                        );
                        return true;
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
