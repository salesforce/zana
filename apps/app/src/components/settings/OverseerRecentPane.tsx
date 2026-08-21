import { useState, useEffect } from 'react';
import type { OverseerAuditEntry } from '@zana-ai/zcc-domain/product';

/**
 * Read-only review of the Overseer's most recent decisions, polled from main's
 * bounded audit ring (`overseer.recent`). The point of dry-run is to WATCH what
 * the cascade would auto-approve before trusting `on`, so this surfaces each
 * decision's tier + computed-vs-acted verdict. In dry-run, `computed:allow` with
 * `acted:ask` is the "would auto-approve" signal; in `on`, `acted:allow` is a
 * real auto-approval. Polls on a slow timer (the ring is small + capped).
 */
export function OverseerRecentPane({ dryRun }: { dryRun: boolean}) {
  const [rows, setRows] = useState<OverseerAuditEntry[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => {
      window.cc.overseer
        .recent(30)
        .then((r) => {
          if (alive) setRows(r);
        })
        .catch(() => {
          /* best-effort; the pane just stays empty */
        });
    };
    load();
    const timer = setInterval(load, 3_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (rows.length === 0) {
    return (
      <p className="settings-hint">
        No decisions yet. Once an agent runs a tool in a new session, the{' '}
        {dryRun ? 'would-be' : ''} auto-approvals show up here.
      </p>
    );
  }

  return (
    <div className="overseer-recent">
      {rows.map((e, i) => {
        // What the operator cares about: was it (or would it be) auto-approved?
        const acted = e.verdict === 'allow';
        const would = !acted && e.computed === 'allow'; // dryRun: would, didn't
        const label = acted ? 'auto-approved' : would ? 'would approve' : 'asked you';
        const cls = acted ? 'ok' : would ? 'would' : 'ask';
        return (
          <div key={`${e.at}-${i}`} className={`overseer-recent-row ${cls}`}>
            <span className="overseer-recent-tool" title={e.reason}>
              {e.toolName}
            </span>
            <span className="overseer-recent-tier">{e.tier}</span>
            <span className="overseer-recent-verdict">{label}</span>
          </div>
        );
      })}
    </div>
  );
}
