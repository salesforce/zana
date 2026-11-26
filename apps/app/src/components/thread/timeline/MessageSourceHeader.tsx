import type { CSSProperties } from 'react';
import type { MessageSource } from '@zana-ai/zcc-domain/thread-runtime';

const KIND_NOUN: Record<MessageSource['kind'], string> = {
  bot: 'Bot',
  thread: 'Thread',
  user: 'You',
  routine: 'Routine',
  job: 'Job'
};

/** Accent for the row; only a validated `#rrggbb` reaches CSS. */
export function messageSourceStyle(source: MessageSource): CSSProperties | undefined {
  return source.color && /^#[0-9a-f]{6}$/i.test(source.color)
    ? ({ '--message-source-color': source.color } as CSSProperties)
    : undefined;
}

function openThread(href: string, event: React.MouseEvent<HTMLAnchorElement>) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  history.pushState({}, '', href);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** Names who sent a message no person typed, such as a bot reply. */
export function MessageSourceHeader({ source }: { source: MessageSource }) {
  const href = source.threadId ? `/threads/${encodeURIComponent(source.threadId)}` : null;
  const initial = Array.from(source.label.trim())[0]?.toUpperCase() ?? '?';
  return (
    <div className="thread-message-source" data-testid="thread-message-source" data-source-kind={source.kind}>
      <span className="thread-message-source-avatar" aria-hidden="true">{initial}</span>
      {href ? (
        <a className="thread-message-source-label" href={href} onClick={(event) => openThread(href, event)}>{source.label}</a>
      ) : (
        <span className="thread-message-source-label">{source.label}</span>
      )}
      <span className="thread-message-source-kind">{KIND_NOUN[source.kind]}</span>
      {source.detail ? <span className="thread-message-source-detail">{source.detail}</span> : null}
    </div>
  );
}
