import { useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { X, type LucideIcon } from 'lucide-react';
import { useDialogFocusTrap } from '../hooks/useDialogFocusTrap.js';

interface Props {
  title: string;
  icon: LucideIcon;
  content: string;
  actionLabel?: string;
  onAction?: () => void;
  onClose: () => void;
}

/**
 * Renders one Home "Guide" as a short markdown article in a modal. Reuses
 * the shortcuts-help shell (`.palette-backdrop` + a dedicated `guide-modal`
 * class) and the inbox's `.inbox-md` markdown styling — no new visual
 * surface for what's fundamentally the same "read some formatted text and
 * close" interaction.
 */
export function GuideModal({ title, icon: Icon, content, actionLabel, onAction, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useDialogFocusTrap(dialogRef, onClose);

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="guide-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="guide-modal-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="guide-modal-header">
          <span className="guide-modal-title-row">
            <Icon size={16} />
            <h3 id="guide-modal-title">{title}</h3>
          </span>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </header>
        <div className="guide-modal-body">
          <div className="inbox-md">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{ a: (props) => <a {...props} target="_blank" rel="noreferrer" /> }}
            >
              {content}
            </ReactMarkdown>
          </div>
        </div>
        {actionLabel && onAction && (
          <footer className="guide-modal-footer">
            <button className="settings-btn settings-btn--primary" onClick={onAction}>
              {actionLabel}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
