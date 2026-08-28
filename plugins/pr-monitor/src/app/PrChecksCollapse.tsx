/**
 * Per-check status list — the body of an expanded {@link PrTile} or compact
 * list row. Renders one line per check with a small pass/fail/pending pip and
 * the raw `gh` state for hover detail.
 */

import { type CheckRun } from '../../lib/types.js';
import { checkStateClass } from './formatHelpers.js';

interface Props {
  checks: CheckRun[];
}

export function PrChecksCollapse({ checks }: Props) {
  if (checks.length === 0) {
    return <div className="prm-checks-empty">No check runs reported.</div>;
  }
  return (
    <ul className="prm-checks-list" role="list">
      {checks.map((c) => {
        const cls = checkStateClass(c.state);
        return (
          <li key={`${c.bucket ?? ''}/${c.name}`} className="prm-check-row">
            <span className={`prm-check-state-pip prm-check-state-pip--${cls}`} aria-hidden />
            <span className="prm-check-name">{c.name}</span>
            {c.bucket && <span className="prm-check-bucket">{c.bucket}</span>}
            <span className="prm-check-state" title={c.state}>
              {c.state.toLowerCase()}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
