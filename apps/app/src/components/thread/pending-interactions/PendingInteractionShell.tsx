import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Link } from 'react-router-dom';

interface SourceThread {
  href: string;
  title: string;
}

export function PendingInteractionShell({
  title,
  sourceThread,
  errorMessage,
  footer,
  footerAriaLabel,
  onFooterKeyDown,
  children
}: {
  title?: string;
  sourceThread?: SourceThread;
  errorMessage?: string | null;
  footer?: ReactNode;
  footerAriaLabel?: string;
  onFooterKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  children?: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div
      className={`thread-pending-banner thread-pending-shell thread-composer-stack-card${collapsed ? ' is-collapsed' : ''}`}
      data-testid="thread-pending-banner"
    >
      <div className="thread-pending-shell-header">
        <span className="thread-pending-attention-dot" aria-hidden="true" />
        {sourceThread ? (
          <Link className="thread-pending-banner-source" to={sourceThread.href}>
            From child agent: {sourceThread.title}
          </Link>
        ) : null}
        {title ? <h3 className="thread-pending-banner-title">{title}</h3> : null}
        <button
          type="button"
          className="thread-pending-shell-toggle"
          data-testid="thread-pending-shell-toggle"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((current) => !current)}
        >
          {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          <span>{collapsed ? 'Expand' : 'Collapse'}</span>
        </button>
      </div>
      {collapsed ? null : (
        <>
          {children}
          {footer ? (
            <div
              className="thread-pending-banner-actions"
              role={footerAriaLabel ? 'toolbar' : undefined}
              aria-label={footerAriaLabel}
              data-testid={footerAriaLabel ? 'thread-pending-decision-toolbar' : undefined}
              onKeyDown={onFooterKeyDown}
            >
              {footer}
            </div>
          ) : null}
          {errorMessage ? <p className="thread-pending-banner-error">{errorMessage}</p> : null}
        </>
      )}
    </div>
  );
}
