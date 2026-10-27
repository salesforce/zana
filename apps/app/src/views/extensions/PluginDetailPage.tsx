import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import './plugin-workbench.css';

/** Full-page plugin destination; the collection stays mounted behind this page. */
export function PluginDetailPage({ label, onBack, children }: {
  label: string;
  onBack: () => void;
  children: ReactNode;
}) {
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    backRef.current?.focus({ preventScroll: true });
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return <section className="ext-plugin-detail-page" aria-label={label}>
    <header className="ext-plugin-detail-page-header">
      <button ref={backRef} type="button" className="ext-plugin-detail-back" onClick={onBack}>
        <ArrowLeft size={16} aria-hidden="true" /> Back to Plugins
      </button>
    </header>
    <div className="ext-plugin-detail-page-body">
      <div className="ext-plugin-detail-content">{children}</div>
    </div>
  </section>;
}
