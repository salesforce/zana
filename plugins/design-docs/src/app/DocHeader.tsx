import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Check, Globe, Hash, MoreHorizontal, Plus, X } from 'lucide-react';
import { DOC_STATUSES, type DesignDocDetail, type DocStatus } from '../shared/contract.js';
import { useDocActions } from './DocActions.js';
import { MAX_SUMMARY_LENGTH, MAX_TAG_LENGTH, MAX_TAGS, MAX_TITLE_LENGTH } from '../shared/limits.js';
import { errorMessage, toast, useApi, type ProjectInfo, type UpdateArgs } from './api.js';
import { ActorLabel, IconButton, MenuItem, Popover, StatusPill, TimeAgo } from './ui.js';

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
  const docActions = useDocActions(projects);
  const project = doc.projectId ? projects.find((entry) => entry.id === doc.projectId) : null;

  const update = async (patch: UpdateArgs) => {
    try {
      await api.update(doc.id, patch);
    } catch (error) {
      toast(`Could not update the doc: ${errorMessage(error)}`, 'error');
      throw error;
    }
  };

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
          {docActions.items(doc, () => setMenu(false), onDeleted)}
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
      {docActions.dialogs}
    </header>
  );
}
