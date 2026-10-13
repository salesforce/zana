import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/** Full text of a run/iteration failure, for rows too narrow to show it. */
export function RunErrorDialog({ title, when, message, onClose }: {
  title: string;
  when: string;
  message: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    node.addEventListener('keydown', onKey);
    node.focus();
    return () => node.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={ref} className="modal scheduler-report-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Run error details" tabIndex={-1}>
        <header className="modal-header">
          <h3>{title}</h3>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </header>
        <div className="scheduler-report-meta">
          <span className="scheduler-pill scheduler-pill--error">error</span>
          <span className="scheduler-report-meta-when">{when}</span>
        </div>
        <div className="modal-body scheduler-report-body">
          <div className="modal-error">{message}</div>
        </div>
      </div>
    </div>
  );
}
