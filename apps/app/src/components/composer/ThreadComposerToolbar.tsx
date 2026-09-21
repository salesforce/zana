import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { SlidersHorizontal } from 'lucide-react';

/** Presentation only: keep each control mounted, including across viewport changes. */
export function ThreadComposerToolbar({
  mode,
  model,
  reasoning,
  sendMode,
  secondaryActions,
  stop,
  send
}: {
  mode: ReactNode;
  model: ReactNode;
  reasoning: ReactNode;
  sendMode: ReactNode;
  secondaryActions: ReactNode;
  stop: ReactNode;
  send: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const options = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!expanded) return;
    options.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const composer = options.current?.closest('.thread-command-composer');
    const writing = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('.thread-command-editor')) {
        setExpanded(false);
      }
    };
    composer?.addEventListener('focusin', writing);
    return () => composer?.removeEventListener('focusin', writing);
  }, [expanded]);
  return (
    <div
      className="ui-command-composer-toolbar thread-command-toolbar"
      data-options-expanded={expanded}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented || !expanded) return;
        event.stopPropagation();
        setExpanded(false);
        toggle.current?.focus();
      }}
    >
      <div className="thread-command-footer-start">
        <div
          ref={options}
          id={`${id}-options`}
          className="thread-command-options"
          role="group"
          aria-label="Additional composer controls"
        >
          <div className="thread-command-option thread-command-option--mode">
            <span className="thread-command-option-label">Mode</span>
            {mode}
          </div>
          <div className="thread-command-option thread-command-option--reasoning">
            <span className="thread-command-option-label">Thinking</span>
            {reasoning}
          </div>
          <div className="thread-command-option thread-command-option--send-mode">
            <span className="thread-command-option-label">While running</span>
            {sendMode}
          </div>
        </div>
        <div className="thread-command-model">{model}</div>
      </div>
      <div className="thread-command-footer-end">
        <div id={`${id}-actions`} className="thread-command-secondary-actions">
          {secondaryActions}
        </div>
        <button
          ref={toggle}
          type="button"
          className="ui-command-icon-button thread-command-options-toggle"
          aria-label="Composer options"
          aria-expanded={expanded}
          aria-controls={`${id}-options ${id}-actions`}
          onClick={() => setExpanded((current) => !current)}
        >
          <SlidersHorizontal size={20} aria-hidden="true" />
        </button>
        {stop}
        {send}
      </div>
    </div>
  );
}
