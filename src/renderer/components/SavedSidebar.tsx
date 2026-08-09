import { useEffect, useMemo } from 'react';
import { Bookmark } from 'lucide-react';
import { useData, useSaved, useSavedSelection } from '../store';
import type { SavedRecord } from '@shared/types';
import { mdToPlainText } from '../util/plainText';

/**
 * Saved-reports list — the "Saved" tab twin of {@link InboxSidebar}. Renders the
 * durable reports the user bookmarked from the inbox detail pane (mirrored into
 * `useSaved` from `~/.zcc/saved/`), newest-first, grouped by project like the
 * feed. Selection drives {@link useSavedSelection}, which the detail pane reads.
 *
 * Read-only over the live store; the only mutation (delete) lives in the detail
 * pane, matching how the inbox splits list vs. detail responsibilities.
 */
export function SavedSidebar({
  query = '',
  scopeProjectId = null
}: {
  query?: string;
  /** When set, show only this project's saved reports (scoped/focused view). */
  scopeProjectId?: string | null;
} = {}) {
  const records = useSaved((s) => s.records);
  const loading = useSaved((s) => s.loading);
  const selectedId = useSavedSelection((s) => s.selectedSavedId);
  const select = useSavedSelection((s) => s.selectSaved);
  const projects = useData((s) => s.projects);
  const scoped = !!scopeProjectId;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return records.filter((r) => {
      if (scopeProjectId && r.projectId !== scopeProjectId) return false;
      if (!q) return true;
      const hay = `${r.projectLabel ?? r.projectId} ${r.title} ${r.comments ?? ''} ${
        r.docs?.map((d) => d.path).join(' ') ?? ''
      }`.toLowerCase();
      return hay.includes(q);
    });
  }, [records, query, scopeProjectId]);

  // Group by project, preserving the newest-first order the store already sorts
  // records into (savedAt desc), so each project's block stays chronological.
  const groups = useMemo(() => {
    const byProject = new Map<string, SavedRecord[]>();
    for (const r of filtered) {
      const list = byProject.get(r.projectId);
      if (list) list.push(r);
      else byProject.set(r.projectId, [r]);
    }
    return Array.from(byProject.entries());
  }, [filtered]);

  const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  // Keep the selection valid and defaulted: a null selection (first load) picks
  // the newest visible report; a stale one (deleted / filtered out) re-points to
  // the newest; an empty list clears it. A still-valid selection is left alone,
  // so this both default-selects AND survives the user's own pick. Fires on
  // `filtered` change (the only thing that can invalidate a selection here).
  useEffect(() => {
    if (selectedId && filtered.some((r) => r.id === selectedId)) return;
    select(filtered[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered]);

  if (loading && records.length === 0) {
    return <div className="inbox-sidebar-empty">Loading…</div>;
  }

  if (records.length === 0) {
    return (
      <div className="inbox-sidebar-empty">
        No saved reports.
        <div className="inbox-sidebar-empty-hint">
          Open a report in the inbox and click the <Bookmark size={11} aria-hidden /> bookmark to
          save it here for later reuse.
        </div>
      </div>
    );
  }

  if (filtered.length === 0) {
    return <div className="inbox-sidebar-empty">No matches.</div>;
  }

  return (
    <div className="inbox-sidebar-list">
      {groups.map(([projectId, recs]) => {
        const project = projectsById.get(projectId) ?? null;
        const name = project?.name ?? recs[0].projectLabel ?? projectId;
        const color = project?.color;
        return (
          <div key={projectId} className="inbox-bucket">
            {!scoped && (
              <div className="inbox-project-group">
                <div className="inbox-project-subhead inbox-project-subhead--static">
                  <span
                    className={`inbox-project-dot ${color ? '' : 'inbox-project-dot--none'}`}
                    style={color ? { background: color } : undefined}
                    aria-hidden
                  />
                  <span className={`inbox-project-name ${project ? '' : 'tombstoned'}`}>{name}</span>
                  <span className="inbox-project-count">{recs.length}</span>
                </div>
              </div>
            )}
            {recs.map((rec) => (
              <SavedRow
                key={rec.id}
                record={rec}
                active={rec.id === selectedId}
                onClick={() => select(rec.id)}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function SavedRow({
  record,
  active,
  onClick
}: {
  record: SavedRecord;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className={`inbox-row saved-row ${active ? 'active' : ''}`}
    >
      <div className="inbox-row-line1">
        <Bookmark size={12} className="saved-row-icon" strokeWidth={2} aria-hidden />
        <span className="inbox-row-preview-inline">{previewFor(record)}</span>
        {(record.docs?.length ?? 0) > 0 && (
          <span
            className="inbox-row-occurrences"
            title={`${record.docs!.length} document${record.docs!.length > 1 ? 's' : ''} snapshotted`}
          >
            📄{record.docs!.length}
          </span>
        )}
        <span className="inbox-row-ts">{formatRelative(record.savedAt)}</span>
      </div>
    </div>
  );
}

/** Row preview: the record's derived title, markdown flattened, else a doc path. */
function previewFor(record: SavedRecord): string {
  const t = record.title?.trim();
  if (t) return mdToPlainText(t);
  const c = (record.comments ?? '').trim();
  if (c) {
    const firstLine = c.split('\n').find((l) => l.trim().length > 0) ?? '';
    return mdToPlainText(firstLine);
  }
  return record.docs?.[0]?.path ?? '(untitled)';
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}
