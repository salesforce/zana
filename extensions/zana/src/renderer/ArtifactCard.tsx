/**
 * ArtifactCard (C3) — a document reading-list entry for the Docs sub-tab.
 *
 * Lifted verbatim from `ZanaPanel.tsx:1200-1259`. Unlike the ticket kanban card,
 * this reads like a library item: a doc icon + prominent wrapping title, a type
 * label, a plain-text excerpt derived from the markdown body, and a metadata row
 * (created date · author · linked-ticket count). Tags trail as subtle chips.
 *
 * Rule 6: imports only B1 shared types + pure `format` helpers — no module bus,
 *   no host accessor, no `'zana'` literal. `onOpen` is a plain
 *   `(a: ZanaArtifact) => void`; the `{ kind: 'artifact' }` `ZanaSelection`
 *   literal is constructed by the view (C2 shell), never here — this keeps the
 *   C4-owned selection union out of C3 and avoids a C3↔C4 import cycle.
 */

import { BookOpen, CalendarRange, Link2, Tag, User } from 'lucide-react';
import type { ZanaArtifact } from '@shared/zana-types';
import { excerptFromMarkdown, fmtDateTime } from './format';

export function ArtifactCard({
  artifact,
  onOpen
}: {
  artifact: ZanaArtifact;
  onOpen: (a: ZanaArtifact) => void;
}) {
  const created = fmtDateTime(artifact.createdAt);
  const excerpt = excerptFromMarkdown(artifact.content);
  const linked = artifact.linkedTickets.length;
  return (
    <article
      className="zana-doc-item"
      onClick={() => onOpen(artifact)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(artifact);
        }
      }}
      title={`${artifact.title} — click to read`}
    >
      <div className="zana-doc-icon" aria-hidden>
        <BookOpen size={18} />
      </div>
      <div className="zana-doc-body">
        <div className="zana-doc-head">
          <h3 className="zana-doc-title">{artifact.title}</h3>
          {artifact.type && <span className="zana-doc-type">{artifact.type}</span>}
        </div>
        {excerpt && <p className="zana-doc-excerpt">{excerpt}</p>}
        <div className="zana-doc-meta">
          {created && (
            <span className="zana-doc-meta-item">
              <CalendarRange size={11} aria-hidden /> {created}
            </span>
          )}
          {artifact.createdBy && (
            <span className="zana-doc-meta-item">
              <User size={11} aria-hidden /> {artifact.createdBy}
            </span>
          )}
          {linked > 0 && (
            <span className="zana-doc-meta-item zana-doc-linked" title="Linked tickets">
              <Link2 size={11} aria-hidden /> {linked} linked {linked === 1 ? 'ticket' : 'tickets'}
            </span>
          )}
        </div>
        {artifact.tags.length > 0 && (
          <div className="zana-doc-tags">
            {artifact.tags.slice(0, 5).map((t) => (
              <span key={t} className="zana-label-chip">
                <Tag size={9} aria-hidden /> {t}
              </span>
            ))}
            {artifact.tags.length > 5 && (
              <span className="gus-chip">+{artifact.tags.length - 5}</span>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
