import { useState } from 'react';
import type { SquadPlanSkipImpact } from '@zana-ai/zcc-domain/squad-proposal';

/** A step as a person knows it: `r4: Read step 4`, or the bare id when there is no title. */
export function stepLabel(id: string, title?: string): string {
  const text = title?.trim();
  return text ? `${id}: ${text}` : id;
}

/** The steps whose failure would skip the most others (at least two), so the card can mark them risky. */
export function riskySkipImpact(rows: readonly SquadPlanSkipImpact[]): ReadonlySet<string> {
  const most = rows.reduce((max, row) => Math.max(max, row.skips.length), 0);
  return most < 2 ? new Set() : new Set(rows.filter((row) => row.skips.length === most).map((row) => row.stepId));
}

/**
 * "If a step fails": per step, how many later steps would be skipped, with the names behind an expander.
 * Collapsed by default so a long plan does not bury the launch card. Advisory: nothing here changes how a failure runs.
 */
export function PlanSkipImpact({ rows, hidden }: { rows: readonly SquadPlanSkipImpact[]; hidden?: number }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  if (!rows.length) return null;
  const risky = riskySkipImpact(rows);
  const sorted = [...rows].sort((a, b) => b.skips.length - a.skips.length);
  const toggle = (id: string) => setOpen((prev) => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    return next;
  });
  return (
    <details className="team-composer-skip-impact" data-testid="plan-skip-impact">
      <summary>{`If a step fails (${risky.size ? `${risky.size} ${risky.size === 1 ? 'step is' : 'steps are'} risky` : `${rows.length} ${rows.length === 1 ? 'step blocks' : 'steps block'} others`})`}</summary>
      <p>A step that fails skips every step that depends on it. Steps no one waits for are not listed.</p>
      <ul>
        {sorted.map((row) => {
          const isOpen = open.has(row.stepId);
          const isRisky = risky.has(row.stepId);
          const listId = `plan-skip-${row.stepId}`;
          return (
            <li key={row.stepId} data-testid={`plan-skip-row-${row.stepId}`} data-risky={isRisky ? 'true' : undefined}>
              <button type="button" className="team-composer-skip-toggle" aria-expanded={isOpen} aria-controls={listId}
                aria-label={`${stepLabel(row.stepId, row.title)}: skips ${row.skips.length}${isRisky ? ', risky' : ''}. ${isOpen ? 'Hide' : 'Show'} the skipped steps`} onClick={() => toggle(row.stepId)}>
                <span className="team-composer-skip-step">{stepLabel(row.stepId, row.title)}</span>
                <span className="team-composer-skip-count" data-testid={`plan-skip-count-${row.stepId}`}>skips {row.skips.length}</span>
                {isRisky ? <span className="team-composer-skip-risky" data-testid={`plan-skip-risky-${row.stepId}`}>Risky</span> : null}
              </button>
              {isOpen ? (
                <ul id={listId} data-testid={`plan-skip-list-${row.stepId}`}>
                  {row.skips.map((id, index) => <li key={id}>{stepLabel(id, row.skipTitles?.[index])}</li>)}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
      {hidden ? <p>and {hidden} more</p> : null}
    </details>
  );
}
