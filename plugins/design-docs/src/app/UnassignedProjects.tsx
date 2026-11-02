import { useState } from 'react';
import { errorMessage, toast, useApi, type ProjectInfo, type UnassignedProject } from './api.js';
import { useProjectMappings } from './hooks.js';
import { Dialog } from './ui.js';

export const UNASSIGNED_LABEL = 'Unassigned from peers';

/**
 * Map projects of other computers to local ones. Nothing is applied unless the user confirms a row;
 * suggestions only preselect nothing. The server re-validates every mapping.
 */
export function UnassignedProjectsDialog({
  unassigned,
  projects,
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

  const confirm = async (foreignProjectId: string) => {
    const local = picks[foreignProjectId];
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

  return (
    <Dialog title="Map peer projects" onClose={onClose} wide footer={<button type="button" className="btn" onClick={onClose}>Close</button>}>
      <p className="dd-field-help dd-muted">
        These docs came from other computers and refer to a Project this computer does not know. Pick a local Project for each one to show its docs there.
      </p>
      {unassigned.length === 0 ? <div className="dd-list-empty dd-muted">Nothing to map.</div> : null}
      {unassigned.map((item) => {
        const picked = picks[item.foreignProjectId] ?? '';
        const suggestion = item.suggestion;
        return (
          <section key={item.foreignProjectId} className="dd-field" aria-label={`Peer project ${item.foreignProjectId}`}>
            <span className="dd-field-label" title={item.foreignProjectId}>
              {item.foreignProjectId} · {item.docCount} {item.docCount === 1 ? 'doc' : 'docs'}
            </span>
            {item.sampleTitles.length ? <span className="dd-muted">{item.sampleTitles.join(' · ')}</span> : null}
            {suggestion ? (
              <span className="dd-muted">
                Suggested: {suggestion.name} (matched by {suggestion.basis}){' '}
                <button type="button" className="btn" onClick={() => setPicks({ ...picks, [item.foreignProjectId]: suggestion.projectId })}>
                  Use suggestion
                </button>
              </span>
            ) : null}
            <span className="dd-field-inline">
              <select
                className="dd-input dd-select"
                aria-label={`Local Project for ${item.foreignProjectId}`}
                value={picked}
                onChange={(event) => setPicks({ ...picks, [item.foreignProjectId]: event.target.value })}
              >
                <option value="">Choose a Project…</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <button type="button" className="btn primary" disabled={!picked || busy !== null} onClick={() => void confirm(item.foreignProjectId)}>
                Confirm
              </button>
            </span>
          </section>
        );
      })}
      {mappings.data?.length ? (
        <section className="dd-field" aria-label="Mapped on this machine">
          <span className="dd-field-label">Mapped on this machine</span>
          {mappings.data.map((mapping) => {
            const name = localName(mapping.localProjectId);
            return (
              <span key={mapping.foreignProjectId} className="dd-field-inline" role="group" aria-label={`Mapping ${mapping.foreignProjectId}`}>
                <span title={mapping.foreignProjectId}>
                  {mapping.foreignProjectId} {'→'} {name ?? (mapping.localRegistered ? mapping.localProjectId : 'Project removed')} · {mapping.docCount} {mapping.docCount === 1 ? 'doc' : 'docs'}
                  {mapping.sampleTitles.length ? <span className="dd-muted"> ({mapping.sampleTitles.join(' · ')})</span> : null}
                </span>
                {confirmUnmap === mapping.foreignProjectId ? (
                  <>
                    <button type="button" className="btn primary" disabled={unmapping !== null} onClick={() => void unmap(mapping.foreignProjectId)}>
                      Confirm unmap
                    </button>
                    <button type="button" className="btn" onClick={() => setConfirmUnmap(null)}>Cancel</button>
                  </>
                ) : (
                  <button type="button" className="btn" aria-label={`Unmap ${mapping.foreignProjectId}`} disabled={unmapping !== null} onClick={() => setConfirmUnmap(mapping.foreignProjectId)}>
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
