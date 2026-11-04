import { useEffect, useState } from 'react';
import { errorMessage, toast, useApi, type ProjectInfo, type UnassignedProject } from './api.js';
import { useProjectMappings, useProjects } from './hooks.js';
import { Dialog } from './ui.js';

export const UNASSIGNED_LABEL = 'Unassigned from peers';

/** The sender's name for a project, or a neutral label; ids are never shown. */
function senderLabel(item: { senderName: string | null }): string {
  return item.senderName ?? 'Unnamed project';
}

function Titles({ titles, total, primary = false }: { titles: string[]; total: number; primary?: boolean }) {
  if (!titles.length) return null;
  const more = total - titles.length;
  return (
    <span className={primary ? 'dd-map-titles-primary' : 'dd-muted dd-map-titles'}>
      {titles.map((title) => `“${title}”`).join(' · ')}
      {more > 0 ? ` · +${more} more` : ''}
    </span>
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
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

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

  const unmap = async (foreignProjectId: string) => {
    if (unmapping) return;
    setUnmapping(foreignProjectId);
    try {
      await api.unmapForeignProject(foreignProjectId);
      toast('Project unmapped. Its docs are back under Unassigned from peers.');
      setConfirmUnmap(null);
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
      mappings.reload();
      onChanged();
    } catch (error) {
      toast(`Could not map the Project: ${errorMessage(error)}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const rows = [...unassigned].sort((a, b) =>
    (a.senderName ?? a.sampleTitles[0] ?? '').localeCompare(b.senderName ?? b.sampleTitles[0] ?? '', undefined, { sensitivity: 'base' }));
  return (
    <Dialog title="Map projects from other computers" onClose={onClose} wide footer={<button type="button" className="btn" onClick={onClose}>Close</button>}>
      <p className="dd-field-help dd-muted">
        These docs came from a project on another computer. Choose which of your Projects they belong to.
      </p>
      {rows.length === 0 ? <div className="dd-list-empty dd-muted">Nothing to map.</div> : null}
      {rows.map((item) => {
        const suggestion = item.suggestion;
        // A suggestion is preselected but nothing is applied until the user presses Map.
        const picked = picks[item.foreignProjectId] ?? suggestion?.projectId ?? '';
        const label = senderLabel(item);
        return (
          <section key={item.foreignProjectId} className="dd-field dd-map-row" aria-label={`Project ${label}`}>
            <span className="dd-field-label">
              <Titles titles={item.sampleTitles} total={item.docCount} primary />
              {!item.sampleTitles.length ? `${item.docCount} ${item.docCount === 1 ? 'doc' : 'docs'}` : null}
            </span>
            <span className="dd-muted dd-map-source">
              From the project “{label}”{item.senderTag ? ` (${item.senderTag})` : ''} on another computer · {item.docCount} {item.docCount === 1 ? 'doc' : 'docs'}
            </span>
            <span className="dd-field-inline">
              <select
                className="dd-input dd-select"
                aria-label={`Your Project for ${label}`}
                value={picked}
                onChange={(event) => setPicks({ ...picks, [item.foreignProjectId]: event.target.value })}
              >
                <option value="">Choose a Project…</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                    {suggestion?.projectId === project.id ? ` (suggested: same ${suggestion.basis})` : ''}
                  </option>
                ))}
              </select>
              <button type="button" className="btn primary" disabled={!picked || busy !== null} onClick={() => void confirm(item.foreignProjectId, picked)}>
                Map
              </button>
            </span>
          </section>
        );
      })}
      {mappings.data?.length ? (
        <section className="dd-field dd-map-row dd-map-mapped" aria-label="Already mapped">
          <span className="dd-field-label">Already mapped</span>
          {mappings.data.map((mapping) => {
            const name = localName(mapping.localProjectId);
            const label = senderLabel(mapping);
            return (
              <span key={mapping.foreignProjectId} className="dd-field-inline" role="group" aria-label={`Mapping ${label}`}>
                <span>
                  {mapping.sampleTitles.length ? <Titles titles={mapping.sampleTitles} total={mapping.docCount} primary /> : <strong>{mapping.docCount} {mapping.docCount === 1 ? 'doc' : 'docs'}</strong>}
                  {' '}{'→'} <strong>{name ?? (mapping.localRegistered ? 'Another Project' : 'Project removed from this computer')}</strong>
                  <span className="dd-muted dd-map-source">From the project “{label}” on another computer · {mapping.docCount} {mapping.docCount === 1 ? 'doc' : 'docs'}</span>
                </span>
                {confirmUnmap === mapping.foreignProjectId ? (
                  <>
                    <button type="button" className="btn primary" disabled={unmapping !== null} onClick={() => void unmap(mapping.foreignProjectId)}>
                      Confirm unmap
                    </button>
                    <button type="button" className="btn" onClick={() => setConfirmUnmap(null)}>Cancel</button>
                  </>
                ) : (
                  <button type="button" className="btn" aria-label={`Unmap ${label}`} disabled={unmapping !== null} onClick={() => setConfirmUnmap(mapping.foreignProjectId)}>
                    Unmap
                  </button>
                )}
              </span>
            );
          })}
        </section>
      ) : null}
    </Dialog>
  );
}
