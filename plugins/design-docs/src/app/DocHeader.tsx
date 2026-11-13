import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronUp, Globe, Hash, MoreHorizontal, Pencil, Plus, X } from 'lucide-react';
import { DOC_STATUSES, type DesignDocDetail, type DocStatus } from '../shared/contract.js';
import { RenameStaleNotice, useDocActions, useTitleRename } from './DocActions.js';
import { MAX_SUMMARY_LENGTH, MAX_TAG_LENGTH, MAX_TAGS, MAX_TITLE_LENGTH } from '../shared/limits.js';
import { errorMessage, toast, useApi, type ProjectInfo, type UpdateArgs } from './api.js';
import { ActorLabel, IconButton, MenuItem, Popover, StatusPill, TimeAgo } from './ui.js';
import { ProjectMark } from './ProjectMark.js';
import { PeerConflictView } from './PeerConflictView.js';
import { effectiveSyncState, SYNC_STATE_HELP, SYNC_STATE_LABEL, useDocSyncStatuses } from './sync-status.js';
import { usePeerSync } from './PeerSettings.js';

/**
 * Text that reads as text until clicked, then edits in place (Enter saves, Escape cancels, blur saves a
 * changed non-empty value). `editing` / `onEditingChange` make the mode controllable so menus and shortcuts can
 * start an edit; `required` turns an empty Enter into a visible error instead of a silent no-op.
 */
export function EditableText({
  value,
  placeholder,
  maxLength,
  multiline = false,
  className = '',
  label,
  required = false,
  editing: controlledEditing,
  onEditingChange,
  onSave
}: {
  value: string;
  placeholder: string;
  maxLength: number;
  multiline?: boolean;
  className?: string;
  label: string;
  required?: boolean;
  editing?: boolean;
  onEditingChange?(editing: boolean): void;
  onSave(next: string): Promise<void> | void;
}) {
  const [innerEditing, setInnerEditing] = useState(false);
  const editing = controlledEditing ?? innerEditing;
  const setEditing = (next: boolean) => {
    if (controlledEditing === undefined) setInnerEditing(next);
    onEditingChange?.(next);
  };
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState(false);
  const done = useRef(false);
  const saveStarted = useRef(onSave);
  const input = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const errorId = useId();

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  // Every way of entering edit mode (click, menu, F2) starts a fresh edit with the text selected.
  useEffect(() => {
    if (!editing) return;
    done.current = false;
    saveStarted.current = onSave;
    setError(false);
    input.current?.focus();
    input.current?.select();
    // onSave is captured on purpose: a save belongs to the doc the edit started on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const finish = async (save: boolean, viaBlur = false) => {
    if (done.current) return;
    const next = draft.trim();
    if (save && required && !next) {
      // Enter on an empty value stays in edit mode with a message; leaving the field just cancels.
      if (viaBlur) save = false;
      else {
        setError(true);
        return;
      }
    }
    done.current = true;
    setEditing(false);
    if (save && next !== value.trim()) {
      try {
        await saveStarted.current(next);
      } catch {
        setDraft(value);
      }
    } else {
      setDraft(value);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      void finish(false);
    } else if (event.key === 'Enter' && (!multiline || event.metaKey || event.ctrlKey || !event.shiftKey)) {
      event.preventDefault();
      void finish(true);
    }
  };

  if (editing) {
    const shared = {
      className: `dd-editable-input ${className}`,
      value: draft,
      maxLength,
      'aria-label': label,
      'aria-invalid': error || undefined,
      'aria-describedby': error ? errorId : undefined,
      ref: input,
      autoFocus: true,
      onChange: (event: { target: { value: string } }) => {
        setDraft(event.target.value);
        setError(false);
      },
      onKeyDown,
      onBlur: () => void finish(true, true)
    };
    const field = multiline ? <textarea {...shared} rows={2} placeholder={placeholder} /> : <input {...shared} placeholder={placeholder} />;
    if (!error) return field;
    return (
      <span className="dd-editable-wrap">
        {field}
        <span id={errorId} className="dd-field-error" role="alert">
          {label} can’t be empty
        </span>
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`dd-editable ${className}${value ? '' : ' dd-editable-empty'}`}
      title={`Edit ${label.toLowerCase()}`}
      onClick={() => setEditing(true)}
    >
      {value || placeholder}
    </button>
  );
}

function TagEditor({ tags, onChange }: { tags: string[]; onChange(tags: string[]): void }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const editStarted = useRef({ tags, onChange });
  const commit = () => {
    const next = draft
      .split(',')
      .map((tag) => tag.trim().toLowerCase().slice(0, MAX_TAG_LENGTH))
      .filter(Boolean);
    setDraft('');
    setAdding(false);
    const merged = [...new Set([...editStarted.current.tags, ...next])].slice(0, MAX_TAGS);
    if (merged.length !== editStarted.current.tags.length) editStarted.current.onChange(merged);
  };
  return (
    <span className="dd-tags">
      {tags.map((tag) => (
        <span key={tag} className="dd-tag">
          <Hash size={10} aria-hidden />
          {tag}
          <button type="button" className="dd-tag-remove" aria-label={`Remove tag ${tag}`} onClick={() => onChange(tags.filter((item) => item !== tag))}>
            <X size={10} aria-hidden />
          </button>
        </span>
      ))}
      {adding ? (
        <input
          className="dd-input dd-tag-input"
          value={draft}
          placeholder="tag, another"
          aria-label="Add tags"
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            } else if (event.key === 'Escape') {
              setDraft('');
              setAdding(false);
            }
          }}
        />
      ) : tags.length < MAX_TAGS ? (
        <button type="button" className="dd-tag dd-tag-add" onClick={() => {
          editStarted.current = { tags, onChange };
          setAdding(true);
        }}>
          <Plus size={10} aria-hidden /> Tag
        </button>
      ) : null}
    </span>
  );
}

function StatusMenu({ status, onChange }: { status: DocStatus; onChange(status: DocStatus): void }) {
  const [open, setOpen] = useState(false);
  const reviewStarted = useRef(onChange);
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      align="start"
      className="dd-menu"
      anchor={
        <button type="button" className="dd-status-button" aria-haspopup="menu" aria-expanded={open} onClick={() => {
          if (!open) reviewStarted.current = onChange;
          setOpen(!open);
        }} title="Change status">
          <StatusPill status={status} />
        </button>
      }
    >
      {DOC_STATUSES.map((option) => (
        <MenuItem
          key={option}
          label={<StatusPill status={option} />}
          checked={option === status}
          icon={option === status ? Check : undefined}
          onSelect={() => {
            setOpen(false);
            if (option !== status) reviewStarted.current(option);
          }}
        />
      ))}
    </Popover>
  );
}

/** Sync state of this doc against the other computers; renders nothing when sync is not set up. */
function SyncLine({ docId, refreshKey, onResolve }: { docId: string; refreshKey: unknown; onResolve(): void }) {
  const api = useApi();
  const status = useDocSyncStatuses(refreshKey, docId).get(docId);
  const peerSync = usePeerSync();
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<number | null>(null);
  const state = status ? effectiveSyncState(status) : null;
  const unsent = open && state === 'unsent';
  // Sync Now is database-wide: count the drafts it would send so the button says what it does.
  useEffect(() => {
    if (!unsent) return;
    let alive = true;
    api.docSyncStatuses().then((rows) => { if (alive) setDrafts(rows.filter((row) => row.state === 'unsent').length); }, () => { if (alive) setDrafts(null); });
    return () => { alive = false; };
  }, [api, unsent]);
  if (!status || !state) return null;
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      className="dd-menu dd-sync-help"
      anchor={
        <button type="button" className={`dd-sync-line dd-sync-${state}`} aria-haspopup="dialog" aria-expanded={open}
          title="Sync status" onClick={() => setOpen(!open)}>
          <span className="dd-sync-dot" aria-hidden /> {SYNC_STATE_LABEL[state]}
        </button>
      }
    >
      <div className="dd-sync-help-body" role="dialog" aria-label="Sync status">
        <strong>{SYNC_STATE_LABEL[state]}</strong>
        <p>{SYNC_STATE_HELP[state]}</p>
        {status.lastError && (state === 'failed' || state === 'waiting') ? (
          <p className="dd-sync-error">Last error: <code>{status.lastError}</code>{status.lastErrorAt ? <> (<TimeAgo at={status.lastErrorAt} now={Date.now()} />)</> : null}</p>
        ) : null}
        {status.differences?.length ? <p>Differs on: {status.differences.join(', ')}</p> : null}
        {state === 'unsent' ? (
          <>
            <button type="button" className="btn primary" disabled={peerSync.syncing} onClick={peerSync.sync}>Sync all docs now</button>
            {drafts ? <p>Sends {drafts} draft{drafts === 1 ? '' : 's'} from this computer.</p> : null}
          </>
        ) : null}
        {state === 'needs-choice' ? <button type="button" className="btn primary" onClick={() => { setOpen(false); onResolve(); }}>Choose a version</button> : null}
      </div>
    </Popover>
  );
}

export function DocHeader({
  doc,
  projects,
  compact,
  collapsible = false,
  actions,
  onDeleted,
  onOpenHistory,
  template = false
}: {
  doc: DesignDocDetail;
  projects: ProjectInfo[];
  compact: boolean;
  /** Narrow screens: start compact, with the summary and tags behind a toggle. */
  collapsible?: boolean;
  /** Primary actions (Ask agent) rendered at the right of the title row. */
  actions?: ReactNode;
  onDeleted(): void;
  /** Show this doc's history (the conflict dialog offers it after a resolution). */
  onOpenHistory?: () => void;
  template?: boolean;
}) {
  const api = useApi();
  const [menu, setMenu] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [conflicts, setConflicts] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const rename = useTitleRename(template ? 'template' : 'doc');
  const menuDoc = useRef(doc);
  const docActions = useDocActions(projects);
  const project = doc.projectId ? projects.find((entry) => entry.id === doc.projectId) : null;

  const update = async (patch: UpdateArgs) => {
    try {
      if (template) await api.templateUpdateMeta(doc.id, { ...patch, expectedHead: doc.head });
      else await api.update(doc.id, { ...patch, expectedHead: doc.head });
    } catch (error) {
      toast(`Could not update the ${template ? 'template' : 'doc'}: ${errorMessage(error)}`, 'error');
      throw error;
    }
  };

  const startRename = () => setRenaming(true);
  // F2 renames the open doc, except while typing somewhere (the title input itself included).
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'F2' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
      event.preventDefault();
      setRenaming(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const collapsed = compact || (collapsible && !expanded);
  return (
    <header className={`dd-doc-header${compact || collapsible ? ' dd-doc-header-compact' : ''}`}>
      <div className="dd-doc-title-row">
        <EditableText
          className="dd-doc-title"
          label="Title"
          value={doc.title}
          placeholder="Untitled design doc"
          maxLength={MAX_TITLE_LENGTH}
          required
          editing={renaming}
          onEditingChange={setRenaming}
          onSave={async (title) => {
            // The save belongs to the doc the edit started on; the toast or stale choice explains a refusal.
            if ((await rename.save(doc, title)) !== 'saved') throw new Error('rename not saved');
          }}
        />
        {renaming ? null : (
          <span className="dd-rename-pencil">
            <IconButton icon={Pencil} label="Rename" hint="Rename (F2)" onClick={startRename} />
          </span>
        )}
        <span className="dd-spacer" />
        {actions}
        {template ? null : <button type="button" className="btn" onClick={() => setConflicts(true)}>Peer conflicts</button>}
        {template ? null : <Popover
          open={menu}
          onClose={() => setMenu(false)}
          className="dd-menu"
          anchor={<IconButton icon={MoreHorizontal} label="More actions" active={menu} onClick={() => {
            if (!menu) menuDoc.current = doc;
            setMenu(!menu);
          }} />}
        >
          {docActions.items(menu ? menuDoc.current : doc, () => setMenu(false), onDeleted, undefined, startRename)}
        </Popover>}
      </div>
      {rename.stale && rename.stale.id === doc.id ? (
        <RenameStaleNotice stale={rename.stale} onKeepMine={() => void rename.keepMine()} onUseTheirs={rename.useTheirs} />
      ) : null}
      {collapsed ? null : (
        <EditableText
          className="dd-doc-summary"
          label="Summary"
          multiline
          value={doc.summary}
          placeholder="Add a one-line summary — agents see it when choosing which doc to read"
          maxLength={MAX_SUMMARY_LENGTH}
          onSave={(summary) => update({ summary })}
        />
      )}
      <div className="dd-doc-meta">
        {template ? null : <StatusMenu status={doc.status} onChange={(status) => void update({ status }).catch(() => undefined)} />}
        {template ? null : <span className="dd-doc-project" title={project ? `Project · ${project.name}` : 'Visible to agents in every project'}>
          {project || doc.projectId ? (
            <ProjectMark projectId={doc.projectId}>{project ? project.name : 'Unknown project'}</ProjectMark>
          ) : (
            <>
              <Globe size={12} aria-hidden />
              Global
            </>
          )}
        </span>}
        {template || collapsed ? null : <TagEditor tags={doc.tags} onChange={(tags) => void update({ tags }).catch(() => undefined)} />}
        <span className="dd-spacer" />
        {template ? null : <SyncLine docId={doc.id} refreshKey={doc.head} onResolve={() => setConflicts(true)} />}
        <span className="dd-doc-updated">
          <ActorLabel actor={doc.updatedBy} /> <TimeAgo at={doc.updatedAt} now={Date.now()} />
        </span>
        {collapsible ? (
          <IconButton
            icon={expanded ? ChevronUp : ChevronDown}
            label={expanded ? 'Hide summary and tags' : 'Show summary and tags'}
            active={expanded}
            onClick={() => setExpanded(!expanded)}
          />
        ) : null}
      </div>
      {template ? null : docActions.dialogs}
      {template ? null : conflicts ? <PeerConflictView key={doc.id} docId={doc.id} onClose={() => setConflicts(false)} onOpenHistory={onOpenHistory ? () => { setConflicts(false); onOpenHistory(); } : undefined} /> : null}
    </header>
  );
}
