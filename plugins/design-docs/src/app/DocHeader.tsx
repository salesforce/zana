import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Archive, ArchiveRestore, Check, Copy, FolderInput, Globe, Hash, MoreHorizontal, Plus, Trash2, X } from 'lucide-react';
import { DOC_STATUSES, designDocDirective, type DesignDocDetail, type DocStatus } from '../shared/contract.js';
import { MAX_SUMMARY_LENGTH, MAX_TAG_LENGTH, MAX_TAGS, MAX_TITLE_LENGTH } from '../shared/limits.js';
import { errorMessage, toast, useApi, type ProjectInfo, type UpdateArgs } from './api.js';
import { ActorLabel, ConfirmDialog, Dialog, IconButton, MenuItem, Popover, StatusPill, TimeAgo, type ConfirmRequest } from './ui.js';

/** Text that reads as text until clicked, then edits in place (Enter saves, Escape cancels). */
export function EditableText({
  value,
  placeholder,
  maxLength,
  multiline = false,
  className = '',
  label,
  onSave
}: {
  value: string;
  placeholder: string;
  maxLength: number;
  multiline?: boolean;
  className?: string;
  label: string;
  onSave(next: string): Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const done = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const finish = async (save: boolean) => {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    const next = draft.trim();
    if (save && next !== value.trim()) {
      try {
        await onSave(next);
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
      autoFocus: true,
      onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
      onKeyDown,
      onBlur: () => void finish(true)
    };
    return multiline ? <textarea {...shared} rows={2} placeholder={placeholder} /> : <input {...shared} placeholder={placeholder} />;
  }
  return (
    <button
      type="button"
      className={`dd-editable ${className}${value ? '' : ' dd-editable-empty'}`}
      title={`Edit ${label.toLowerCase()}`}
      onClick={() => {
        done.current = false;
        setEditing(true);
      }}
    >
      {value || placeholder}
    </button>
  );
}

function TagEditor({ tags, onChange }: { tags: string[]; onChange(tags: string[]): void }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const commit = () => {
    const next = draft
      .split(',')
      .map((tag) => tag.trim().toLowerCase().slice(0, MAX_TAG_LENGTH))
      .filter(Boolean);
    setDraft('');
    setAdding(false);
    const merged = [...new Set([...tags, ...next])].slice(0, MAX_TAGS);
    if (merged.length !== tags.length) onChange(merged);
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
        <button type="button" className="dd-tag dd-tag-add" onClick={() => setAdding(true)}>
          <Plus size={10} aria-hidden /> Tag
        </button>
      ) : null}
    </span>
  );
}

function StatusMenu({ status, onChange }: { status: DocStatus; onChange(status: DocStatus): void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      align="start"
      className="dd-menu"
      anchor={
        <button type="button" className="dd-status-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} title="Change status">
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
            if (option !== status) onChange(option);
          }}
        />
      ))}
    </Popover>
  );
}

function MoveDialog({
  doc,
  projects,
  onClose,
  onMove
}: {
  doc: DesignDocDetail;
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

export function DocHeader({
  doc,
  projects,
  compact,
  actions,
  onDeleted
}: {
  doc: DesignDocDetail;
  projects: ProjectInfo[];
  compact: boolean;
  /** Primary actions (Ask agent) rendered at the right of the title row. */
  actions?: ReactNode;
  onDeleted(): void;
}) {
  const api = useApi();
  const [menu, setMenu] = useState(false);
  const [moving, setMoving] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const project = doc.projectId ? projects.find((entry) => entry.id === doc.projectId) : null;

  const update = async (patch: UpdateArgs) => {
    try {
      await api.update(doc.id, patch);
    } catch (error) {
      toast(`Could not update the doc: ${errorMessage(error)}`, 'error');
      throw error;
    }
  };

  const archived = doc.status === 'archived';
  return (
    <header className={`dd-doc-header${compact ? ' dd-doc-header-compact' : ''}`}>
      <div className="dd-doc-title-row">
        <EditableText
          className="dd-doc-title"
          label="Title"
          value={doc.title}
          placeholder="Untitled design doc"
          maxLength={MAX_TITLE_LENGTH}
          onSave={(title) => (title ? update({ title }) : undefined)}
        />
        <span className="dd-spacer" />
        {actions}
        <Popover
          open={menu}
          onClose={() => setMenu(false)}
          className="dd-menu"
          anchor={<IconButton icon={MoreHorizontal} label="More actions" active={menu} onClick={() => setMenu(!menu)} />}
        >
          <MenuItem
            icon={Copy}
            label="Copy chat reference"
            hint="Paste into any thread"
            onSelect={() => {
              setMenu(false);
              void copy(designDocDirective(doc.id), 'reference');
            }}
          />
          <MenuItem
            icon={Hash}
            label="Copy id"
            hint={doc.slug}
            onSelect={() => {
              setMenu(false);
              void copy(doc.id, 'id');
            }}
          />
          <MenuItem
            icon={FolderInput}
            label="Move to project…"
            onSelect={() => {
              setMenu(false);
              setMoving(true);
            }}
          />
          <MenuItem
            icon={archived ? ArchiveRestore : Archive}
            label={archived ? 'Unarchive' : 'Archive'}
            onSelect={() => {
              setMenu(false);
              void update({ status: archived ? 'draft' : 'archived' }).catch(() => undefined);
            }}
          />
          <MenuItem
            icon={Trash2}
            label="Delete…"
            danger
            onSelect={() => {
              setMenu(false);
              setConfirm({
                title: 'Delete design doc',
                body: (
                  <>
                    Delete <strong>{doc.title}</strong> with its {doc.files.length} file{doc.files.length === 1 ? '' : 's'}, comments and history? This
                    cannot be undone. Archive it instead to keep it out of agents' way.
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
              });
            }}
          />
        </Popover>
      </div>
      {compact ? null : (
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
        <StatusMenu status={doc.status} onChange={(status) => void update({ status }).catch(() => undefined)} />
        <span className="dd-doc-project" title={project ? `Project · ${project.name}` : 'Visible to agents in every project'}>
          {project ? null : <Globe size={12} aria-hidden />}
          {project ? project.name : doc.projectId ? 'Unknown project' : 'Global'}
        </span>
        {compact ? null : <TagEditor tags={doc.tags} onChange={(tags) => void update({ tags }).catch(() => undefined)} />}
        <span className="dd-spacer" />
        <span className="dd-doc-updated">
          <ActorLabel actor={doc.updatedBy} /> <TimeAgo at={doc.updatedAt} now={Date.now()} />
        </span>
      </div>
      {moving ? (
        <MoveDialog
          doc={doc}
          projects={projects}
          onClose={() => setMoving(false)}
          onMove={(projectId) => update({ projectId }).catch(() => undefined)}
        />
      ) : null}
      {confirm ? <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} /> : null}
    </header>
  );
}
