/**
 * SprintsList (C3) — the Sprints sub-tab. Lifted from `ZanaPanel.tsx:923-952`.
 * Prop-driven + testable: the view does the `useTickets((s) => s.sprints)` read
 * and passes `sprints`; the row click forwards to `onOpenSprint(s.id)` instead of
 * inlining the legacy `setSprintFilter + selectTab` pair (the view binds that to
 * the store's `openSprint` action).
 *
 * Sprint label is the RAW `s.name ?? shortId(s.id)` — deliberately NOT routed
 * through `resolveSprintName` (that synthetic-`Sprint <hash>` suppression is a
 * ticket-CARD concern; the Sprints list shows the raw name).
 *
 * Rule 6: B1 shared types + the pure `shortId` helper only — no host / module
 *   bus / `'zana'` literal. Rule 5: renders store-resident `sprints`; no fetch.
 */

import { CircleDot } from 'lucide-react';
import type { ZanaSprint } from '@shared/zana-types';
import { shortId } from './format';

export function SprintsList({
  sprints,
  onOpenSprint
}: {
  sprints: ZanaSprint[];
  onOpenSprint: (sprintId: string) => void;
}) {
  return (
    <div className="zana-list">
      {sprints.length === 0 && <div className="gus-column-empty">No sprints.</div>}
      {sprints.map((s) => (
        <button
          key={s.id}
          type="button"
          className="zana-sprint-row"
          onClick={() => onOpenSprint(s.id)}
          title="View this sprint's tickets"
        >
          <div className="zana-sprint-main">
            <span className="zana-sprint-name">{s.name ?? shortId(s.id)}</span>
            {s.status && <span className="gus-chip">{s.status}</span>}
          </div>
          <div className="zana-sprint-counts">
            <span className="zana-sprint-count">
              <CircleDot size={12} aria-hidden /> {s.openCount ?? 0} open
            </span>
            <span className="zana-sprint-count">{s.ticketCount ?? 0} total</span>
          </div>
        </button>
      ))}
    </div>
  );
}
