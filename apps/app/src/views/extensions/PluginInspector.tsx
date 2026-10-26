import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import './plugin-workbench.css';

export function PluginInspector({ label, onClose, children }: {
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <aside className="ext-plugin-inspector" aria-label={label} onKeyDown={(event) => {
    if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('[role="dialog"]')) {
      event.stopPropagation();
      onCloseRef.current();
    }
  }}>
    <header className="ext-plugin-inspector-chrome"><span>{label}</span>
      <button ref={closeRef} type="button" className="icon-btn" aria-label="Close plugin details" onClick={onClose}><X size={17} /></button>
    </header>
    <div className="ext-plugin-inspector-body">{children}</div>
  </aside>;
}
