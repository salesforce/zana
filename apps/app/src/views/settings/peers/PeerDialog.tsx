import type { ReactNode } from 'react';

/** Local Settings sheet used for connection flows; the page behind it stays visible but inactive. */
export function PeerDialog({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="peers-dialog-backdrop" role="presentation">
      <section className="peers-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        {children}
      </section>
    </div>
  );
}
