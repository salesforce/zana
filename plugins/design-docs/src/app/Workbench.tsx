import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useZccNavigate } from '@zana-ai/zcc-plugin-sdk/app';
import { PopoverPicklist, type PopoverPicklistOption } from '@zana-ai/zcc-ui/popover-picklist';
import { Bot, CircleDot, DraftingCompass, FileText, FolderOpen, MessageSquare, PanelLeftClose, PanelLeftOpen, Plus, Search, Sparkles, X } from 'lucide-react';
import { STATUS_LABELS, DOC_STATUSES, type DesignDocSummary, type DocStatus } from '../shared/contract.js';
import { MAX_AGENT_PROMPT_LENGTH } from '../shared/agent-actions.js';
import { MAX_SUMMARY_LENGTH, MAX_TITLE_LENGTH } from '../shared/limits.js';
import { DOC_PANEL_ACTION } from './Agents.js';
import { errorMessage, toast, useApi, type ProjectInfo, type TemplateInfo } from './api.js';
import type { DocLocation } from './content.js';
import { useDocActions } from './DocActions.js';
import { DocView } from './DocView.js';
import { useDocs, useNow, usePersistentState, useProjects, useTemplates } from './hooks.js';
import { ContextMenu, contextMenuPoint, Dialog, IconButton, Spinner, StatusPill, TimeAgo } from './ui.js';

type StatusFilter = DocStatus | 'active' | 'all';
const GLOBAL_ONLY = '__global__';

const BRIEF_LIMIT = MAX_AGENT_PROMPT_LENGTH - 600;

const STATUS_OPTIONS: PopoverPicklistOption<StatusFilter>[] = [
  { value: 'active', label: 'Active', description: 'Everything except archived' },
  ...DOC_STATUSES.map((status) => ({ value: status, label: STATUS_LABELS[status] })),
  { value: 'all', label: 'All statuses' }
];

function countedOption(value: string, label: string, count: number): PopoverPicklistOption<string> {
  return {
    value,
    label,
    content: (
      <span className="dd-pick-row">
        <span className="dd-pick-label">{label}</span>
        <span className="dd-pick-count">{count}</span>
      </span>
    )
  };
}

/** Project choices: only those with docs in the list, with counts, plus the current pick. */
export function projectOptions(docs: DesignDocSummary[], projects: ProjectInfo[], selected: string): PopoverPicklistOption<string>[] {
  const counts = new Map<string | null, number>();
  for (const doc of docs) counts.set(doc.projectId, (counts.get(doc.projectId) ?? 0) + 1);
  const options = [countedOption('', 'All projects', docs.length)];
  if (counts.has(null) || selected === GLOBAL_ONLY) options.push(countedOption(GLOBAL_ONLY, 'Global docs', counts.get(null) ?? 0));
  for (const project of projects) {
    if (counts.has(project.id) || selected === project.id) options.push(countedOption(project.id, project.name, counts.get(project.id) ?? 0));
  }
  return options;
}

export function draftingPrompt(brief: string): string {
  return [
    'Draft this design doc from the brief below. Fill in every section of its template with concrete, specific content grounded in this project, add diagrams where they help, and mark open questions and assumptions explicitly. Keep it concise.',
    'Brief:',
    brief.trim()
  ].join('\n\n');
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function DocRow({
  doc,
  active,
  projectName,
  now,
  menuOpen,
  onSelect,
  onMenu
}: {
  doc: DesignDocSummary;
  active: boolean;
  projectName: string | null;
  now: number;
  menuOpen: boolean;
  onSelect(): void;
  onMenu(at: { x: number; y: number }): void;
}) {
  return (
    <button
      type="button"
      className={`dd-doc-row${active ? ' on' : ''}${menuOpen ? ' dd-doc-row-menu' : ''}`}
      onClick={onSelect}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(contextMenuPoint(event));
      }}
      aria-current={active ? 'page' : undefined}
      aria-haspopup="menu"
    >
      <span className="dd-doc-row-top">
        <span className="dd-doc-row-title">{doc.title}</span>
        <StatusPill status={doc.status} compact />
      </span>
      {doc.summary ? <span className="dd-doc-row-summary">{doc.summary}</span> : null}
      <span className="dd-doc-row-meta">
        {projectName !== null ? (
          <span className="dd-doc-row-project" title={projectName}>
            {projectName}
          </span>
        ) : null}
        <span title={`${doc.fileCount} files`}>
          <FileText size={11} aria-hidden /> {doc.fileCount}
        </span>
        {doc.openComments ? (
          <span title={`${doc.openComments} open comments`} className="dd-doc-row-comments">
            <MessageSquare size={11} aria-hidden /> {doc.openComments}
          </span>
        ) : null}
        {doc.updatedBy.kind === 'agent' ? (
          <span title="Last edited by an agent">
            <Bot size={11} aria-label="Last edited by an agent" />
          </span>
        ) : null}
        <span className="dd-spacer" />
        <TimeAgo at={doc.updatedAt} now={now} />
      </span>
    </button>
  );
}

function DocList({
  projectId,
  showProjects,
  projects,
  activeId,
  onSelect,
  onDeleted,
  onNew,
  onCollapse,
  headerActions
}: {
  projectId: string | null;
  showProjects: boolean;
  projects: ProjectInfo[];
  activeId: string | null;
  onSelect(docId: string): void;
  onDeleted(docId: string): void;
  onNew(): void;
  onCollapse(): void;
  headerActions?: ReactNode;
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = usePersistentState<StatusFilter>('list-status', 'active');
  const [projectFilter, setProjectFilter] = usePersistentState<string>('list-project', '');
  const [menu, setMenu] = useState<{ doc: DesignDocSummary; at: { x: number; y: number } } | null>(null);
  const docActions = useDocActions(projects);
  const debounced = useDebounced(query.trim(), 200);
  const now = useNow();
  const docs = useDocs({ ...(projectId ? { projectId } : {}), ...(debounced ? { query: debounced } : {}), status });
  const names = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects]);
  const visible = useMemo(() => {
    const all = docs.data ?? [];
    if (!showProjects || !projectFilter) return all;
    return all.filter((doc) => (projectFilter === GLOBAL_ONLY ? doc.projectId === null : doc.projectId === projectFilter));
  }, [docs.data, showProjects, projectFilter]);
  const filtered = status !== 'active' || (showProjects && !!projectFilter);
  const projectChoices = useMemo(
    () => (showProjects ? projectOptions(docs.data ?? [], projects, projectFilter) : []),
    [showProjects, docs.data, projects, projectFilter]
  );

  return (
    <div className="dd-list">
      <div className="dd-list-head">
        <span className="dd-list-title">Design docs</span>
        {docs.data ? (
          <span className="dd-list-count" title={`${visible.length} ${visible.length === 1 ? 'doc' : 'docs'}`}>
            {visible.length}
          </span>
        ) : null}
        <span className="dd-spacer" />
        <button type="button" className="btn primary dd-new" onClick={onNew}>
          <Plus size={13} aria-hidden /> New
        </button>
        <IconButton icon={PanelLeftClose} label="Hide doc list" onClick={onCollapse} />
        {headerActions}
      </div>
      <div className="dd-list-tools">
        <label className="dd-search">
          <Search size={13} aria-hidden />
          <input value={query} placeholder="Search docs and content" aria-label="Search design docs" onChange={(event) => setQuery(event.target.value)} />
          {query ? (
            <button type="button" className="dd-search-clear" aria-label="Clear search" onClick={() => setQuery('')}>
              <X size={12} aria-hidden />
            </button>
          ) : null}
        </label>
      </div>
      <div className="dd-list-filters">
        <PopoverPicklist
          ariaLabel="Filter by status"
          value={status}
          options={STATUS_OPTIONS}
          onChange={setStatus}
          searchable={false}
          triggerClassName={`launch-model-picker-trigger dd-pick${status !== 'active' ? ' on' : ''}`}
          triggerIcon={<CircleDot size={12} aria-hidden />}
        />
        {showProjects ? (
          <PopoverPicklist
            ariaLabel="Filter by project"
            value={projectFilter}
            options={projectChoices}
            onChange={setProjectFilter}
            searchable={projectChoices.length > 8}
            searchPlaceholder="Search projects…"
            minWidth={220}
            triggerClassName={`launch-model-picker-trigger dd-pick${projectFilter ? ' on' : ''}`}
            triggerIcon={<FolderOpen size={12} aria-hidden />}
          />
        ) : null}
      </div>
      <div className="dd-list-scroll">
        {docs.error ? <div className="dd-banner dd-banner-error">{docs.error}</div> : null}
        {!docs.data && docs.loading ? (
          <div className="dd-center">
            <Spinner label="Loading design docs" />
          </div>
        ) : null}
        {docs.data && !visible.length ? (
          <div className="dd-list-empty dd-muted">{debounced || filtered ? 'No docs match.' : 'No design docs yet.'}</div>
        ) : null}
        {visible.map((doc) => (
          <DocRow
            key={doc.id}
            doc={doc}
            active={doc.id === activeId}
            projectName={showProjects ? (doc.projectId ? names.get(doc.projectId) ?? 'Unknown project' : 'Global') : doc.projectId ? null : 'Global'}
            now={now}
            menuOpen={menu?.doc.id === doc.id}
            onSelect={() => onSelect(doc.id)}
            onMenu={(at) => setMenu({ doc, at })}
          />
        ))}
      </div>
      {menu ? (
        <ContextMenu key={`${menu.doc.id}@${menu.at.x},${menu.at.y}`} at={menu.at} label={`Actions for ${menu.doc.title}`} onClose={() => setMenu(null)}>
          {docActions.items(
            menu.doc,
            () => setMenu(null),
            () => onDeleted(menu.doc.id),
            menu.doc.id === activeId ? undefined : () => onSelect(menu.doc.id)
          )}
        </ContextMenu>
      ) : null}
      {docActions.dialogs}
    </div>
  );
}

function TemplateCards({ templates, selected, onSelect }: { templates: TemplateInfo[]; selected: string | null; onSelect(id: string): void }) {
  return (
    <div className="dd-templates" role="radiogroup" aria-label="Template">
      {templates.map((template) => (
        <button
          key={template.id}
          type="button"
          role="radio"
          aria-checked={selected === template.id}
          className={`dd-template${selected === template.id ? ' on' : ''}`}
          onClick={() => onSelect(template.id)}
        >
          <span className="dd-template-label">{template.label}</span>
          <span className="dd-template-desc">{template.description}</span>
          <span className="dd-template-files">{template.files.join(' · ')}</span>
        </button>
      ))}
    </div>
  );
}

export function NewDocDialog({
  initialTemplate,
  defaultProjectId,
  projects,
  onClose,
  onCreated
}: {
  initialTemplate?: string | null;
  defaultProjectId: string | null;
  projects: ProjectInfo[];
  onClose(): void;
  onCreated(docId: string): void;
}) {
  const api = useApi();
  const navigate = useZccNavigate();
  const templates = useTemplates();
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [template, setTemplate] = useState<string | null>(initialTemplate ?? null);
  const [projectId, setProjectId] = useState(defaultProjectId ?? '');
  const [tags, setTags] = useState('');
  const [brief, setBrief] = useState('');
  const [busy, setBusy] = useState(false);
  const chosen = template ?? templates.data?.[0]?.id ?? null;
  const drafting = !!brief.trim();
  const agentProject = projectId || defaultProjectId || projects[0]?.id || '';

  const create = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      const doc = await api.create({
        title: title.trim(),
        ...(summary.trim() ? { summary: summary.trim() } : {}),
        ...(chosen ? { template: chosen } : {}),
        tags: tags
          .split(',')
          .map((tag) => tag.trim().toLowerCase())
          .filter(Boolean),
        projectId: projectId || null
      });
      onCreated(doc.id);
      if (drafting) {
        if (!agentProject) {
          toast('Doc created. Add a project to let an agent draft it.', 'error');
        } else {
          const result = await api.askAgent(doc.id, { prompt: draftingPrompt(brief), projectId: agentProject });
          navigate.openThreadPanel({ actionId: DOC_PANEL_ACTION, title: doc.title, params: { docId: doc.id }, threadId: result.threadId });
          navigate.toThread(result.threadId);
          toast(`An agent is drafting “${doc.title}”. Watch it fill in beside the chat.`);
        }
      }
      onClose();
    } catch (error) {
      toast(`Could not create the doc: ${errorMessage(error)}`, 'error');
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="New design doc"
      wide
      onClose={onClose}
      footer={
        <>
          <span className="dd-muted dd-dialog-hint">{drafting ? 'An agent starts a new thread to draft it.' : 'You can ask an agent to fill it in later.'}</span>
          <span className="dd-spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={!title.trim() || busy} onClick={() => void create()}>
            {busy ? <Spinner size={12} /> : drafting ? <Sparkles size={12} aria-hidden /> : null}
            {drafting ? 'Create & draft with agent' : 'Create'}
          </button>
        </>
      }
    >
      <form
        className="dd-form"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <label className="dd-field">
          <span className="dd-field-label">Title</span>
          <input
            className="dd-input"
            value={title}
            maxLength={MAX_TITLE_LENGTH}
            placeholder="e.g. Offline sync for the mobile app"
            onChange={(event) => setTitle(event.target.value)}
            autoFocus
          />
        </label>
        <label className="dd-field">
          <span className="dd-field-label">Summary</span>
          <input
            className="dd-input"
            value={summary}
            maxLength={MAX_SUMMARY_LENGTH}
            placeholder="One line agents see when deciding which doc to read"
            onChange={(event) => setSummary(event.target.value)}
          />
        </label>
        <div className="dd-field">
          <span className="dd-field-label">Template</span>
          {templates.data ? <TemplateCards templates={templates.data} selected={chosen} onSelect={setTemplate} /> : <Spinner label="Loading templates" />}
        </div>
        <div className="dd-field-row">
          <label className="dd-field">
            <span className="dd-field-label">Project</span>
            <select className="dd-input dd-select" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              <option value="">Global (all projects)</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label className="dd-field">
            <span className="dd-field-label">Tags</span>
            <input className="dd-input" value={tags} placeholder="sync, mobile" onChange={(event) => setTags(event.target.value)} />
          </label>
        </div>
        <label className="dd-field">
          <span className="dd-field-label">
            <Sparkles size={12} aria-hidden /> Brief for an agent <span className="dd-muted">(optional)</span>
          </span>
          <textarea
            className="dd-input"
            rows={4}
            value={brief}
            maxLength={BRIEF_LIMIT}
            placeholder="Describe the problem, constraints and any ideas. An agent will draft the doc from this while you watch."
            onChange={(event) => setBrief(event.target.value)}
          />
        </label>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function Landing({ templates, onNew }: { templates: TemplateInfo[] | null; onNew(template?: string): void }) {
  return (
    <div className="dd-landing">
      <div className="dd-landing-inner">
        <span className="dd-landing-icon">
          <DraftingCompass size={26} aria-hidden />
        </span>
        <h1 className="dd-landing-title">Design docs your agents work on with you</h1>
        <p className="dd-landing-lede">
          Each doc is a small project of Markdown, Mermaid diagrams and HTML mockups. Agents in this project know your docs, read them for
          context, edit them, and leave review comments. You watch every change land live.
        </p>
        <ul className="dd-landing-points">
          <li>
            <Sparkles size={13} aria-hidden /> <strong>Ask agent</strong> to review, fill gaps, add diagrams or check a design against the code.
          </li>
          <li>
            <MessageSquare size={13} aria-hidden /> Select any passage to comment. Agents address open comments.
          </li>
          <li>
            <Bot size={13} aria-hidden /> Every save is versioned, so an agent's edit is always one click from undone.
          </li>
        </ul>
        <div className="dd-landing-start">
          <span className="dd-section-label">Start from a template</span>
          {templates ? <TemplateCards templates={templates} selected={null} onSelect={(id) => onNew(id)} /> : <Spinner />}
        </div>
      </div>
    </div>
  );
}

/**
 * Doc list + doc. `variant` "global" (the nav panel) lists every project's
 * docs; "project" (the project tab) lists one project's docs plus global ones.
 */
export function Workbench({
  projectId,
  location,
  onLocationChange,
  variant,
  headerActions
}: {
  projectId: string | null;
  location: DocLocation;
  onLocationChange(location: DocLocation, replace?: boolean): void;
  variant: 'global' | 'project';
  /** Host split-pane actions for a project tab with a custom header. */
  headerActions?: ReactNode;
}) {
  const projects = useProjects();
  const templates = useTemplates();
  const [creating, setCreating] = useState<{ template: string | null } | null>(null);
  const [listOpen, setListOpen] = usePersistentState<boolean>('list-open', true);
  const projectList = projects.data ?? [];

  return (
    <div className="dd-root dd-workbench">
      {listOpen ? (
        <DocList
          projectId={variant === 'project' ? projectId : null}
          showProjects={variant === 'global'}
          projects={projectList}
          activeId={location.docId}
          onSelect={(docId) => onLocationChange({ docId, path: null })}
          onDeleted={(docId) => {
            if (docId === location.docId) onLocationChange({ docId: null, path: null });
          }}
          onNew={() => setCreating({ template: null })}
          onCollapse={() => setListOpen(false)}
          headerActions={headerActions}
        />
      ) : (
        <nav className="dd-list-collapsed" aria-label="Design docs">
          <IconButton icon={PanelLeftOpen} label="Show doc list" onClick={() => setListOpen(true)} />
          <IconButton icon={Plus} label="New design doc" onClick={() => setCreating({ template: null })} />
          {headerActions}
        </nav>
      )}
      <main className="dd-main">
        {location.docId ? (
          <DocView
            key={location.docId}
            docId={location.docId}
            path={location.path}
            layout="workbench"
            contextProjectId={projectId}
            onOpenPath={(path, replace) => onLocationChange({ docId: location.docId, path }, replace ?? true)}
            onDeleted={() => onLocationChange({ docId: null, path: null })}
          />
        ) : (
          <Landing templates={templates.data} onNew={(template) => setCreating({ template: template ?? null })} />
        )}
      </main>
      {creating ? (
        <NewDocDialog
          initialTemplate={creating.template}
          defaultProjectId={projectId}
          projects={projectList}
          onClose={() => setCreating(null)}
          onCreated={(docId) => onLocationChange({ docId, path: null })}
        />
      ) : null}
    </div>
  );
}
