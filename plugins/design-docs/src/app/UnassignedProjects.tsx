import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage, toast, useApi, type ProjectInfo, type UnassignedProject } from './api.js';
import { useProjectMappings, useProjects } from './hooks.js';
import { Dialog } from './ui.js';

export const UNASSIGNED_LABEL = 'Unassigned from peers';

/** Most titles rendered in an expanded list; the rest are summarised as "and N more". */
const MAX_TITLES_SHOWN = 200;

/**
 * The server returns at most 200 unassigned projects and 200 mappings (MAX_UNASSIGNED / MAX_MAPPINGS in
 * src/server/project-refs.ts), so a list that reaches this length may be truncated and is counted as "200+".
 */
const LIST_CAP = 200;
const countLabel = (n: number) => (n >= LIST_CAP ? `${LIST_CAP}+` : String(n));

const docs = (count: number) => `${count} ${count === 1 ? 'doc' : 'docs'}`;

/** Heading for a foreign project: the sender's name, else its first doc title; ids are never shown. */
function headingLabel(item: { senderName: string | null; sampleTitles: string[] }): string {
  return item.senderName ?? item.sampleTitles[0] ?? 'Unnamed project';
}

type TitlesState = { status: 'loading' } | { status: 'ready'; titles: string[] } | { status: 'error'; message: string };

/** Lazily loads (and caches) the full title list of a foreign project the first time it is opened. */
function useForeignTitles() {
  const api = useApi();
  const [state, setState] = useState<ReadonlyMap<string, TitlesState>>(new Map());
  const started = useRef(new Set<string>());
  // Request generation per id: a response applies only while it is still the latest request for that id.
  const generation = useRef(new Map<string, number>());
  const load = useCallback((id: string, retry = false) => {
    if (started.current.has(id) && !retry) return;
    started.current.add(id);
    const mine = (generation.current.get(id) ?? 0) + 1;
    generation.current.set(id, mine);
    const current = () => generation.current.get(id) === mine;
    setState((prev) => new Map(prev).set(id, { status: 'loading' }));
    api.listForeignProjectTitles(id).then(
      (titles) => { if (current()) setState((prev) => new Map(prev).set(id, { status: 'ready', titles })); },
      (error: unknown) => { if (current()) setState((prev) => new Map(prev).set(id, { status: 'error', message: errorMessage(error) })); }
    );
  }, [api]);
  /** Drop a cached list (its doc count changed) so the next open, or the caller, fetches fresh titles. */
  const invalidate = useCallback((id: string) => {
    started.current.delete(id);
    generation.current.set(id, (generation.current.get(id) ?? 0) + 1); // orphan any in-flight request
    setState((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);
  return { state, load, invalidate };
}

/** The expanded, scrolling title list with its loading and retryable-error states. */
function TitleList({ id, total, state, load }: { id: string; total: number; state: TitlesState | undefined; load(id: string, retry?: boolean): void }) {
  if (!state || state.status === 'loading') return <div className="dd-muted dd-map-status" role="status">Loading titles…</div>;
  if (state.status === 'error') {
    return (
      <div className="dd-map-status" role="alert">
        <span>Could not load titles: {state.message}</span>{' '}
        <button type="button" className="dd-map-link" onClick={() => load(id, true)}>Retry</button>
      </div>
    );
  }
  const shown = state.titles.slice(0, MAX_TITLES_SHOWN);
  const more = Math.max(total, state.titles.length) - shown.length;
  return (
    <ul className="dd-map-tlist" tabIndex={0} aria-label="Doc titles">
      {shown.map((title, index) => <li key={index}>{title}</li>)}
      {more > 0 ? <li className="dd-map-more">and {more} more</li> : null}
    </ul>
  );
}

/**
 * Map projects of other computers to local ones. Nothing is applied unless the user confirms a row;
 * suggestions are preselected but applied only when the user presses Map. The server re-validates every mapping.
 */
export function UnassignedProjectsDialog({
  unassigned,
  projects: initialProjects,
  onClose,
  onChanged
}: {
  unassigned: UnassignedProject[];
  projects: ProjectInfo[];
  onClose(): void;
  onChanged(): void;
}) {
  const api = useApi();
  const [picks, setPicks] = useState<ReadonlyMap<string, string>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const titles = useForeignTitles();
  const [openDocs, setOpenDocs] = useState<ReadonlyMap<string, boolean>>(new Map());
  // null = no explicit choice yet: collapsed while docs need a Project, open once everything is mapped.
  const [mappedOpen, setMappedOpen] = useState<boolean | null>(null);
  // Cards mapped in this session leave "Needs a Project" immediately, before the parent reloads.
  const [justMapped, setJustMapped] = useState<Set<string>>(new Set());

  const mappings = useProjectMappings(true);
  const [unmapping, setUnmapping] = useState<string | null>(null);
  const [confirmUnmap, setConfirmUnmap] = useState<string | null>(null);
  // Re-read the Projects each time the dialog opens and when the window regains focus, so a Project
  // added meanwhile can be picked without reloading the app.
  const fresh = useProjects();
  const reloadProjects = fresh.reload;
  useEffect(() => {
    window.addEventListener('focus', reloadProjects);
    return () => window.removeEventListener('focus', reloadProjects);
  }, [reloadProjects]);
  const projects = fresh.data ?? initialProjects;
  const localName = (id: string) => projects.find((project) => project.id === id)?.name;

  // A card's doc count changing means its cached title list is stale: drop it, and refetch if it is open.
  const seenCounts = useRef(new Map<string, number>());
  const { invalidate, load: loadTitles } = titles;
  useEffect(() => {
    const current = [...unassigned, ...(mappings.data ?? [])];
    for (const entry of current) {
      const known = seenCounts.current.get(entry.foreignProjectId);
      if (known !== undefined && known !== entry.docCount) {
        invalidate(entry.foreignProjectId);
        if (openDocs.get(entry.foreignProjectId)) loadTitles(entry.foreignProjectId);
      }
      seenCounts.current.set(entry.foreignProjectId, entry.docCount);
    }
  }, [unassigned, mappings.data, invalidate, loadTitles, openDocs]);

  const toggleDocs = (id: string) => {
    const next = !openDocs.get(id);
    setOpenDocs(new Map(openDocs).set(id, next));
    if (next) titles.load(id);
  };

  const unmap = async (foreignProjectId: string) => {
    if (unmapping) return;
    setUnmapping(foreignProjectId);
    try {
      await api.unmapForeignProject(foreignProjectId);
      toast('Project unmapped. Its docs are back under Unassigned from peers.');
      setConfirmUnmap(null);
      setJustMapped((prev) => {
        const next = new Set(prev);
        next.delete(foreignProjectId);
        return next;
      });
      mappings.reload();
      onChanged();
    } catch (error) {
      toast(`Could not unmap the Project: ${errorMessage(error)}`, 'error');
    } finally {
      setUnmapping(null);
    }
  };

  const confirm = async (foreignProjectId: string, local: string) => {
    if (!local || busy) return;
    setBusy(foreignProjectId);
    try {
      await api.mapForeignProject(foreignProjectId, local);
      toast('Project mapped. Its docs now show under that Project.');
      setJustMapped((prev) => new Set(prev).add(foreignProjectId));
      setMappedOpen(true);
      mappings.reload();
      onChanged();
    } catch (error) {
      toast(`Could not map the Project: ${errorMessage(error)}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const rows = unassigned
    .filter((item) => !justMapped.has(item.foreignProjectId))
    .sort((a, b) => headingLabel(a).localeCompare(headingLabel(b), undefined, { sensitivity: 'base' }));
  const mapped = mappings.data ?? [];
  const mappedVisible = mappedOpen ?? rows.length === 0;
  const anyMapped = mapped.length > 0 || justMapped.size > 0; // a just-mapped card counts before the list reloads
  const nothingAtAll = rows.length === 0 && !anyMapped && mappings.data !== null;
  return (
    <Dialog title="Map projects from other computers" onClose={onClose} wide footer={<button type="button" className="btn" onClick={onClose}>Close</button>}>
      <p className="dd-field-help dd-muted">
        These docs came from a project on another computer. Choose which of your Projects they belong to.
      </p>
      {nothingAtAll ? <div className="dd-list-empty dd-muted">No docs from other computers yet.</div> : null}
      {rows.length ? <h4 className="dd-map-section">Needs a Project ({countLabel(rows.length)})</h4> : null}
      {rows.length === 0 && anyMapped ? <div className="dd-list-empty dd-muted">All synced docs are in a Project.</div> : null}
      {rows.map((item) => {
        const id = item.foreignProjectId;
        const suggestion = item.suggestion;
        // A suggestion is preselected but nothing is applied until the user presses Map.
        const picked = picks.get(id) ?? suggestion?.projectId ?? '';
        const pickedName = projects.find((project) => project.id === picked)?.name;
        const label = headingLabel(item);
        const open = !!openDocs.get(id);
        const shownPreview = item.sampleTitles.slice(0, 2);
        const preview = shownPreview.join(' · ');
        return (
          <section key={id} className="dd-map-card" aria-label={`Project ${label}`}>
            <div className="dd-map-card-head">
              <strong>{label}</strong>
              <span className="dd-muted">
                {docs(item.docCount)} · from another computer{item.senderTag ? ` (${item.senderTag})` : ''}
              </span>
            </div>
            {open ? (
              <TitleList id={id} total={item.docCount} state={titles.state.get(id)} load={titles.load} />
            ) : preview ? (
              <div className="dd-muted dd-map-preview">{preview}{item.docCount > shownPreview.length ? ` · +${item.docCount - shownPreview.length}` : ''}</div>
            ) : null}
            <button type="button" className="dd-map-link" aria-expanded={open} onClick={() => toggleDocs(id)}>
              {open ? 'Hide docs' : 'Show docs'}
            </button>
            <div className="dd-map-pick">
              <span className="dd-muted" aria-hidden="true">Map to</span>
              <select
                className="dd-input dd-select"
                aria-label={`Your Project for ${label}`}
                value={picked}
                onChange={(event) => setPicks(new Map(picks).set(id, event.target.value))}
              >
                <option value="">Choose a Project…</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
              {suggestion && picked === suggestion.projectId ? <span className="dd-map-chip">Suggested · same {suggestion.basis}</span> : null}
              <button type="button" className="btn primary" disabled={!picked || busy !== null} onClick={() => void confirm(id, picked)}>
                {picked ? `Map ${docs(item.docCount)} to ${pickedName ?? 'Project'}` : 'Map docs'}
              </button>
            </div>
          </section>
        );
      })}
      {mapped.length ? (
        <section className="dd-map-mapped" aria-label="Already mapped">
          <button type="button" className="dd-map-acc" aria-expanded={mappedVisible} onClick={() => setMappedOpen(!mappedVisible)}>
            <span aria-hidden="true">{mappedVisible ? '▾' : '▸'}</span> Already mapped ({countLabel(mapped.length)})
          </button>
          {mappedVisible ? mapped.map((mapping) => {
            const id = mapping.foreignProjectId;
            const name = localName(mapping.localProjectId);
            const label = headingLabel(mapping);
            const open = !!openDocs.get(id);
            return (
              <div key={id} className="dd-map-grid" role="group" aria-label={`Mapping ${label}`}>
                <div className="dd-map-src">
                  <button type="button" className="dd-map-link dd-map-exp" aria-expanded={open} aria-label={`Toggle docs for ${label}`} onClick={() => toggleDocs(id)}>
                    {open ? '▾' : '▸'}
                  </button>
                  {label} <span className="dd-muted">· {docs(mapping.docCount)} →</span>
                </div>
                <div className="dd-map-tgt">
                  <span className="dd-map-tgt-name">{name ?? (mapping.localRegistered ? 'Another Project' : '—')}</span>
                  {!name && !mapping.localRegistered ? <span className="dd-map-tag">Project removed from this computer</span> : null}
                </div>
                <div className="dd-map-act">
                  {confirmUnmap === id ? (
                    <>
                      <button type="button" className="btn primary" disabled={unmapping !== null} onClick={() => void unmap(id)}>Confirm unmap</button>
                      <button type="button" className="btn" onClick={() => setConfirmUnmap(null)}>Cancel</button>
                    </>
                  ) : (
                    <button type="button" className="btn" aria-label={`Unmap ${label}`} disabled={unmapping !== null} onClick={() => setConfirmUnmap(id)}>Unmap</button>
                  )}
                </div>
                {open ? <div className="dd-map-grid-titles"><TitleList id={id} total={mapping.docCount} state={titles.state.get(id)} load={titles.load} /></div> : null}
              </div>
            );
          }) : null}
        </section>
      ) : null}
    </Dialog>
  );
}
