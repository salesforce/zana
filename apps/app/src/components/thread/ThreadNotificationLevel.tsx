import { useEffect, useState } from 'react';
import { Bell, Check, ChevronDown, ChevronRight } from 'lucide-react';
import {
  NOTIFICATION_LEVEL_LABELS,
  OWN_NOTIFICATION_LEVELS,
  describeNotificationSource,
  type OwnNotificationLevel,
  type ThreadNotificationState
} from '@zana-ai/zcc-domain';
import { product } from '../../lib/product-client.js';
import { errorMessage, useUi } from '../../store.js';

type Load = { status: 'loading' } | { status: 'unavailable' } | { status: 'ready'; state: ThreadNotificationState };

/**
 * Per-thread phone-notification level for a thread menu. Fetches the level when
 * the menu opens and re-renders from the server's answer to every change, so
 * the menu always shows what the server will actually do (an ancestor's mute
 * can outrank the level picked here). Rendered as menu children (no wrapper) so
 * the surrounding menu's button styling applies.
 */
export function ThreadNotificationLevelControl({ threadId }: { threadId: string }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let current = true;
    setLoad({ status: 'loading' });
    product.threads
      .notificationLevel(threadId)
      .then((state) => {
        if (current) setLoad({ status: 'ready', state });
      })
      .catch(() => {
        if (current) setLoad({ status: 'unavailable' });
      });
    return () => {
      current = false;
    };
  }, [threadId]);

  const choose = async (level: OwnNotificationLevel) => {
    if (saving || load.status !== 'ready' || level === load.state.own) return;
    setSaving(true);
    try {
      const state = await product.threads.setNotificationLevel(threadId, level);
      setLoad({ status: 'ready', state });
    } catch (error) {
      useUi.getState().pushToast(errorMessage(error, 'Failed to change notifications'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const ready = load.status === 'ready' ? load.state : null;
  const summary = ready ? NOTIFICATION_LEVEL_LABELS[ready.effective] : load.status === 'unavailable' ? 'Unavailable' : null;
  const open = expanded && ready !== null;
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <>
      <button
        type="button"
        data-testid="thread-notification-level"
        disabled={ready === null}
        aria-expanded={open}
        aria-label={summary ? `Notifications: ${summary}` : 'Notifications'}
        title="Choose which events on this thread send a notification to your phone"
        onClick={() => setExpanded((value) => !value)}
      >
        <Bell size={13} aria-hidden="true" />
        Notifications
        {summary ? <span className="thread-notification-summary">{summary}</span> : null}
        {ready ? <Chevron size={12} aria-hidden="true" /> : null}
      </button>
      {open && ready ? (
        <>
          {OWN_NOTIFICATION_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              role="menuitemradio"
              aria-checked={ready.own === level}
              disabled={saving}
              className="thread-notification-option"
              onClick={() => void choose(level)}
            >
              {NOTIFICATION_LEVEL_LABELS[level]}
              {ready.own === level ? <Check size={13} className="inbox-menu-check" aria-hidden="true" /> : null}
            </button>
          ))}
          <div className="thread-notification-hint">{levelHint(ready)}</div>
        </>
      ) : null}
    </>
  );
}

function levelHint(state: ThreadNotificationState): string {
  return `${NOTIFICATION_LEVEL_LABELS[state.effective]}: ${describeNotificationSource(state.source)}`;
}
