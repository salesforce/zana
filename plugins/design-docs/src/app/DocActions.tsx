import { useState, type ReactNode } from 'react';
import { Archive, ArchiveRestore, Copy, FolderInput, FolderOpen, Hash, Trash2 } from 'lucide-react';
import { designDocDirective, type DesignDocSummary } from '../shared/contract.js';
import { errorMessage, toast, useApi, type ProjectInfo, type UpdateArgs } from './api.js';
import { ConfirmDialog, Dialog, MenuItem, type ConfirmRequest } from './ui.js';

function MoveDialog({
  doc,
  projects,
  onClose,
  onMove
}: {
  doc: Pick<DesignDocSummary, 'projectId'>;
  projects: ProjectInfo[];
  onClose(): void;
  onMove(projectId: string | null): Promise<void>;
}) {
  const [target, setTarget] = useState(doc.projectId ?? '');
  return (
    <Dialog
      title="Move design doc"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={target === (doc.projectId ?? '')}
            onClick={() => void onMove(target || null).then(onClose)}
          >
            Move
          </button>
        </>
      }
    >
      <label className="dd-field">
        <span className="dd-field-label">Project</span>
        <select className="dd-input dd-select" value={target} onChange={(event) => setTarget(event.target.value)}>
          <option value="">Global — every project's agents can see it</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
      <p className="dd-muted dd-field-help">Agents are told about the docs of the project they run in, plus global docs.</p>
    </Dialog>
  );
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`Copied ${what}`);
  } catch {
    toast(`Could not copy ${what}`, 'error');
  }
}

/**
 * What a user can do to a doc, shared by the doc header's menu and the doc
 * list's right-click menu. `items` fills a menu; `dialogs` must stay mounted
 * after the menu closes, since moving and deleting ask first.
 */
export function useDocActions(projects: ProjectInfo[]): {
  items(doc: DesignDocSummary, close: () => void, onDeleted: () => void, onOpen?: () => void): ReactNode;
  dialogs: ReactNode;
} {
  const api = useApi();
  const [moving, setMoving] = useState<DesignDocSummary | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  const update = async (doc: DesignDocSummary, patch: UpdateArgs) => {
    try {
      await api.update(doc.id, patch);
    } catch (error) {
      toast(`Could not update the doc: ${errorMessage(error)}`, 'error');
    }
  };

  const items = (doc: DesignDocSummary, close: () => void, onDeleted: () => void, onOpen?: () => void) => {
    const archived = doc.status === 'archived';
    const run = (action: () => void) => () => {
      close();
      action();
    };
    return (
      <>
        {onOpen ? <MenuItem icon={FolderOpen} label="Open" onSelect={run(onOpen)} /> : null}
        <MenuItem icon={Copy} label="Copy chat reference" hint="Paste into any thread" onSelect={run(() => void copy(designDocDirective(doc.id), 'reference'))} />
        <MenuItem icon={Hash} label="Copy id" hint={doc.slug} onSelect={run(() => void copy(doc.id, 'id'))} />
        <MenuItem icon={FolderInput} label="Move to project…" onSelect={run(() => setMoving(doc))} />
        <MenuItem
          icon={archived ? ArchiveRestore : Archive}
          label={archived ? 'Unarchive' : 'Archive'}
          onSelect={run(() => void update(doc, { status: archived ? 'draft' : 'archived' }))}
        />
        <MenuItem
          icon={Trash2}
          label="Delete…"
          danger
          onSelect={run(() =>
            setConfirm({
              title: 'Delete design doc',
              body: (
                <>
                  Delete <strong>{doc.title}</strong> with its {doc.fileCount} file{doc.fileCount === 1 ? '' : 's'}, comments and history? This cannot be
                  undone. Archive it instead to keep it out of agents' way.
                </>
              ),
              confirmLabel: 'Delete',
              danger: true,
              run: async () => {
                try {
                  await api.remove(doc.id);
                  toast(`Deleted “${doc.title}”`);
                  onDeleted();
                } catch (error) {
                  toast(`Could not delete: ${errorMessage(error)}`, 'error');
                }
              }
            })
          )}
        />
      </>
    );
  };

  const dialogs = (
    <>
      {moving ? (
        <MoveDialog doc={moving} projects={projects} onClose={() => setMoving(null)} onMove={(projectId) => update(moving, { projectId })} />
      ) : null}
      {confirm ? <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} /> : null}
    </>
  );
  return { items, dialogs };
}
