import { useEffect, useState, type ReactNode } from 'react';
import { Archive, ArchiveRestore, Copy, Download, FolderInput, FolderOpen, GitFork, Hash, Link2, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import { designDocDirective, type DesignDocSummary } from '../shared/contract.js';
import { crossDocMarkdownLink } from '../shared/paths.js';
import { copyText } from './clipboard.js';
import { errorMessage, toast, useApi, type DocKind, type ProjectInfo, type UpdateArgs } from './api.js';
import { saveBytes, siteZip } from './download.js';
import { useDocs, useUnassignedProjects } from './hooks.js';
import { UnassignedProjectsDialog } from './UnassignedProjects.js';
import { ConfirmDialog, Dialog, MenuItem, Spinner, type ConfirmRequest } from './ui.js';

function MoveDialog({
  doc,
  projects,
  onClose,
  onMove
}: {
  doc: Pick<DesignDocSummary, 'projectId'>;
  projects: ProjectInfo[];
  onClose(): void;
  onMove(projectId: string | null): Promise<boolean>;
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
            onClick={() => void onMove(target || null).then((moved) => { if (moved) onClose(); })}
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

/**
 * Pick the doc this one is an alternative to: the doc's project and global
 * docs, minus itself and docs that are alternatives already (one level deep).
 */
export function AlternativeDialog({
  doc,
  onClose,
  onPick
}: {
  doc: Pick<DesignDocSummary, 'id' | 'title' | 'projectId' | 'alternativeTo'>;
  onClose(): void;
  onPick(alternativeTo: string | null): Promise<boolean>;
}) {
  const docs = useDocs({ ...(doc.projectId ? { projectId: doc.projectId } : {}), status: 'active' });
  const [target, setTarget] = useState(doc.alternativeTo ?? '');
  const all = docs.data ?? [];
  const candidates = all.filter((other) => other.id !== doc.id && !other.alternativeTo);
  const ownAlternatives = all.filter((other) => other.alternativeTo === doc.id).length;
  return (
    <Dialog
      title="Alternative to…"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={target === (doc.alternativeTo ?? '') || ownAlternatives > 0}
            onClick={() => void onPick(target || null).then((saved) => { if (saved) onClose(); })}
          >
            Save
          </button>
        </>
      }
    >
      {docs.data ? (
        <label className="dd-field">
          <span className="dd-field-label">“{doc.title}” is an alternative to</span>
          <select className="dd-input dd-select" value={target} disabled={ownAlternatives > 0} onChange={(event) => setTarget(event.target.value)}>
            <option value="">Nothing: a doc of its own</option>
            {candidates.map((other) => (
              <option key={other.id} value={other.id}>
                {other.title}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <Spinner label="Loading design docs" />
      )}
      <p className="dd-muted dd-field-help">
        {ownAlternatives > 0
          ? `This doc has ${ownAlternatives} alternative${ownAlternatives === 1 ? '' : 's'} of its own. Detach them first: alternatives nest one level deep.`
          : 'Alternatives are listed under the doc they compete with, so competing proposals stay together.'}
      </p>
    </Dialog>
  );
}

/**
 * The delete confirmation. Sync state is read when the dialog opens so the copy matches what the server will do:
 * in a sync group the delete reaches every paired computer.
 */
export function DeleteDocBody({ doc }: { doc: Pick<DesignDocSummary, 'title' | 'fileCount'> }) {
  const api = useApi();
  // null = not known yet (loading or the lookup failed): warn conservatively rather than imply the delete stays local.
  const [paired, setPaired] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    void api.peerStatus().then(
      (status) => { if (active) setPaired(status.configured); },
      (error) => { console.warn('[design-docs] could not read sync status for the delete confirmation', error); }
    );
    return () => { active = false; };
  }, [api]);
  return (
    <>
      Delete <strong>{doc.title}</strong> with its {doc.fileCount} file{doc.fileCount === 1 ? '' : 's'}, comments and history?
      {paired === true ? ' It will also be deleted on your paired computers.' : null}
      {paired === null ? ' If this computer is paired with others, it will also be deleted on them.' : null} This cannot be
      undone. Archive it instead to keep it out of agents' way.
    </>
  );
}

function MenuDivider() {
  return <div className="dd-menu-sep" role="separator" />;
}

/** The save was refused because the doc's head moved on (another computer, an agent). */
export function isStaleHead(error: unknown): boolean {
  return /head changed|changed since revision/i.test(errorMessage(error));
}

/** A rename that lost to another computer's rename: both titles stay on screen until the user picks. */
export interface RenameStale {
  id: string;
  mine: string;
  theirs: string;
  head: string | null;
}

/**
 * The one save path every rename entry point uses (`update({ title })`). A stale head never overwrites:
 * if the title itself changed elsewhere the user chooses (`stale`); any other stale head is an error toast
 * and is never retried against the newer head.
 */
export function useTitleRename(kind: DocKind = 'doc') {
  const api = useApi();
  const [stale, setStale] = useState<RenameStale | null>(null);
  const write = (id: string, title: string, head: string | null) =>
    kind === 'template' ? api.templateUpdateMeta(id, { title, expectedHead: head }) : api.update(id, { title, expectedHead: head });
  const noun = kind === 'template' ? 'template' : 'doc';

  /** 'stale' leaves the choice in `stale`; 'failed' has already toasted. */
  const save = async (doc: { id: string; title: string; head: string | null }, title: string): Promise<'saved' | 'stale' | 'failed'> => {
    try {
      await write(doc.id, title, doc.head);
      setStale(null);
      return 'saved';
    } catch (error) {
      if (!isStaleHead(error)) {
        toast(`Could not update the ${noun}: ${errorMessage(error)}`, 'error');
        return 'failed';
      }
      try {
        const latest = await api.get(doc.id, kind);
        if (latest.title.trim() === title) {
          setStale(null);
          return 'saved';
        }
        if (latest.title === doc.title) {
          // Only other parts of the doc moved: consent was given for the old head, so never retry against a newer one.
          toast(`Could not update the ${noun}: ${errorMessage(error)}`, 'error');
          return 'failed';
        }
        setStale({ id: doc.id, mine: title, theirs: latest.title, head: latest.head });
        return 'stale';
      } catch (retry) {
        toast(`Could not update the ${noun}: ${errorMessage(retry)}`, 'error');
        return 'failed';
      }
    }
  };

  const keepMine = async () => {
    if (!stale) return;
    try {
      await write(stale.id, stale.mine, stale.head);
      setStale(null);
    } catch (error) {
      toast(`Could not update the ${noun}: ${errorMessage(error)}`, 'error');
      setStale(null);
    }
  };

  return { save, stale, keepMine, useTheirs: () => setStale(null) };
}

export function RenameStaleNotice({ stale, onKeepMine, onUseTheirs }: { stale: RenameStale; onKeepMine(): void; onUseTheirs(): void }) {
  return (
    <div className="dd-rename-stale" role="alert">
      <span>
        Title changed on another computer to <strong>{stale.theirs}</strong>
      </span>
      <button type="button" className="btn" onClick={onKeepMine}>
        Keep yours
      </button>
      <button type="button" className="btn" onClick={onUseTheirs}>
        Use theirs
      </button>
    </div>
  );
}

async function copy(text: string, what: string) {
  if (await copyText(text)) toast(`Copied ${what}`);
  else toast(`Could not copy ${what}`, 'error');
}

/**
 * What a user can do to a doc, shared by the doc header's menu and the doc
 * list's right-click menu. `items` fills a menu; `dialogs` must stay mounted
 * after the menu closes, since moving and deleting ask first.
 */
export function useDocActions(projects: ProjectInfo[]): {
  items(doc: DesignDocSummary, close: () => void, onDeleted: () => void, onOpen?: () => void, onRename?: () => void): ReactNode;
  dialogs: ReactNode;
} {
  const api = useApi();
  const [moving, setMoving] = useState<DesignDocSummary | null>(null);
  const [linking, setLinking] = useState<DesignDocSummary | null>(null);
  const [mapping, setMapping] = useState(false);
  const unassigned = useUnassignedProjects(mapping);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  const update = async (doc: DesignDocSummary, patch: UpdateArgs) => {
    try {
      await api.update(doc.id, { ...patch, expectedHead: doc.head });
      return true;
    } catch (error) {
      toast(`Could not update the doc: ${errorMessage(error)}`, 'error');
      return false;
    }
  };

  const pin = async (doc: DesignDocSummary, pinned: boolean) => {
    try {
      await api.pin(doc.id, pinned);
    } catch (error) {
      toast(`Could not ${pinned ? 'pin' : 'unpin'} the doc: ${errorMessage(error)}`, 'error');
    }
  };

  const download = async (doc: DesignDocSummary) => {
    try {
      const site = await api.siteFiles(doc.id);
      saveBytes(`${site.slug}.zip`, siteZip(site.slug, site.files), 'application/zip');
    } catch (error) {
      toast(`Could not download the doc: ${errorMessage(error)}`, 'error');
    }
  };

  const items = (doc: DesignDocSummary, close: () => void, onDeleted: () => void, onOpen?: () => void, onRename?: () => void) => {
    const archived = doc.status === 'archived';
    const run = (action: () => void) => () => {
      close();
      action();
    };
    return (
      <>
        {onOpen ? <MenuItem icon={FolderOpen} label="Open" onSelect={run(onOpen)} /> : null}
        {doc.pinnedAt !== null ? (
          <MenuItem icon={PinOff} label="Unpin" onSelect={run(() => void pin(doc, false))} />
        ) : (
          <MenuItem icon={Pin} label="Pin to top" onSelect={run(() => void pin(doc, true))} />
        )}
        <MenuDivider />
        <MenuItem icon={Copy} label="Copy chat reference" hint="Paste into any thread" onSelect={run(() => void copy(designDocDirective(doc.id), 'reference'))} />
        <MenuItem icon={Link2} label="Copy doc link" hint="Paste into another doc" onSelect={run(() => void copy(crossDocMarkdownLink(doc), 'doc link'))} />
        <MenuItem icon={Hash} label="Copy id" hint={doc.id} onSelect={run(() => void copy(doc.id, 'id'))} />
        <MenuItem icon={Download} label="Download .zip" hint={`${doc.slug}.zip`} onSelect={run(() => void download(doc))} />
        <MenuDivider />
        {onRename ? <MenuItem icon={Pencil} label="Rename" hint="F2" onSelect={run(onRename)} /> : null}
        {doc.projectLocked ? (
          <MenuItem icon={FolderInput} label="Map to a Project…" hint="Peer-owned" onSelect={run(() => setMapping(true))} />
        ) : (
          <MenuItem icon={FolderInput} label="Move to project…" onSelect={run(() => setMoving(doc))} />
        )}
        <MenuItem
          icon={GitFork}
          label="Alternative to…"
          hint={doc.alternativeTo ? 'Linked' : undefined}
          onSelect={run(() => setLinking(doc))}
        />
        <MenuDivider />
        <MenuItem
          icon={archived ? ArchiveRestore : Archive}
          label={archived ? 'Unarchive' : 'Archive'}
          onSelect={run(() => void update(doc, { status: archived ? 'draft' : 'archived' }))}
        />
        <MenuItem
          icon={Trash2}
          label="Delete…"
          danger
          onSelect={run(() => askDelete(doc, onDeleted))}
        />
      </>
    );
  };

  const askDelete = (doc: DesignDocSummary, onDeleted: () => void) => {
    setConfirm({
      title: 'Delete design doc',
      body: <DeleteDocBody doc={doc} />,
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
    });
  };

  const dialogs = (
    <>
      {moving ? (
        <MoveDialog doc={moving} projects={projects} onClose={() => setMoving(null)} onMove={(projectId) => update(moving, { projectId })} />
      ) : null}
      {linking ? (
        <AlternativeDialog doc={linking} onClose={() => setLinking(null)} onPick={(alternativeTo) => update(linking, { alternativeTo })} />
      ) : null}
      {mapping ? (
        <UnassignedProjectsDialog unassigned={unassigned.data ?? []} projects={projects} onClose={() => setMapping(false)} onChanged={() => unassigned.reload()} />
      ) : null}
      {confirm ? <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} /> : null}
    </>
  );
  return { items, dialogs };
}
