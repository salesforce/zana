/**
 * DocsList (C3) — the Docs sub-tab reading-list. Lifted from
 * `ZanaPanel.tsx:954-965`. Prop-driven + testable: it renders one
 * {@link ArtifactCard} per artifact and forwards the click to `onOpen`.
 *
 * Rule 6: no host / module-bus / `'zana'` literal. The artifact-open selection
 *   is routed through `onOpen` (the view binds it to the store's detail-open
 *   action) — this component never imports the modal nor constructs a
 *   `ZanaSelection` literal.
 * Rule 5: renders store-resident `artifacts` only; fires no fetch.
 */

import type { ZanaArtifact } from '@shared/zana-types';
import { ArtifactCard } from './ArtifactCard';

export function DocsList({
  artifacts,
  onOpen
}: {
  artifacts: ZanaArtifact[];
  onOpen: (a: ZanaArtifact) => void;
}) {
  return (
    <div className="zana-doc-list">
      {artifacts.length === 0 && <div className="gus-column-empty">No docs.</div>}
      {artifacts.map((a) => (
        <ArtifactCard key={a.id} artifact={a} onOpen={onOpen} />
      ))}
    </div>
  );
}
