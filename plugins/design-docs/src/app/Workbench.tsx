import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useZccNavigate } from '@zana-ai/zcc-plugin-sdk/app';
import { Bot, DraftingCompass, FileText, Filter, MessageSquare, Plus, Search, Sparkles, X } from 'lucide-react';
import { STATUS_LABELS, DOC_STATUSES, type DesignDocSummary, type DocStatus } from '../shared/contract.js';
import { MAX_AGENT_PROMPT_LENGTH } from '../shared/agent-actions.js';
import { MAX_SUMMARY_LENGTH, MAX_TITLE_LENGTH } from '../shared/limits.js';
import { DOC_PANEL_ACTION } from './Agents.js';
import { errorMessage, toast, useApi, type ProjectInfo, type TemplateInfo } from './api.js';
import type { DocLocation } from './content.js';
import { DocView } from './DocView.js';
import { useDocs, useNow, usePersistentState, useProjects, useTemplates } from './hooks.js';
import { Dialog, IconButton, MenuItem, Popover, Spinner, StatusPill, TimeAgo } from './ui.js';

type StatusFilter = DocStatus | 'active' | 'all';
const GLOBAL_ONLY = '__global__';

const BRIEF_LIMIT = MAX_AGENT_PROMPT_LENGTH - 600;

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
  onSelect
}: {
  doc: DesignDocSummary;
  active: boolean;
  projectName: string | null;
  now: number;
  onSelect(): void;
}) {
  return (
    <button type="button" className={`dd-doc-row${active ? ' on' : ''}`} onClick={onSelect} aria-current={active ? 'page' : undefined}>
      <span className="dd-doc-row-top">
        <span className="dd-doc-row-title">{doc.title}</span>
        <StatusPill status={doc.status} compact />
      </span>
      {doc.summary ? <span className="dd-doc-row-summary">{doc.summary}</span> : null}
      <span className="dd-doc-row-meta">
        {projectName !== null ? <span className="dd-doc-row-project">{projectName}</span> : null}
        <span title={`${doc.fileCount} files`}>
          <FileText size={11} aria-hidden /> {doc.fileCount}
        </span>
        {doc.openComments ? (
          <span title={`${doc.openComments} open comments`} className="dd-doc-row-comments">
            <MessageSquare size={11} aria-hidden /> {doc.openComments}
          </span>
        ) : null}
        {doc.updatedBy.kind === 'agent' ? <Bot size={11} aria-label="Last edited by an agent" /> : null}
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
  onNew,
  headerActions
}: {
  projectId: string | null;
  showProjects: boolean;
  projects: ProjectInfo[];
  activeId: string | null;
  onSelect(docId: string): void;
  onNew(): void;
  headerActions?: ReactNode;
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = usePersistentState<StatusFilter>('list-status', 'active');
  const [projectFilter, setProjectFilter] = usePersistentState<string>('list-project', '');
  const [filterOpen, setFilterOpen] = useState(false);
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
  const statusLabel = status === 'active' ? 'Active' : status === 'all' ? 'All' : STATUS_LABELS[status];

  return (
    <div className="dd-list">
      <div className="dd-list-head">
        <span className="dd-list-title">Design docs</span>
        <span className="dd-spacer" />
        <button type="button" className="btn primary dd-new" onClick={onNew}>
          <Plus size={13} aria-hidden /> New
        </button>
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
        <Popover
          open={filterOpen}
          onClose={() => setFilterOpen(false)}
          className="dd-menu"
          anchor={<IconButton icon={Filter} label={`Filter (${statusLabel})`} active={filtered || filterOpen} onClick={() => setFilterOpen(!filterOpen)} />}
        >
          <div className="dd-menu-section">Status</div>
          {(['active', ...DOC_STATUSES, 'all'] as StatusFilter[]).map((option) => (
            <MenuItem
              key={option}
              label={option === 'active' ? 'Active (not archived)' : option === 'all' ? 'All' : STATUS_LABELS[option]}
              checked={option === status}
              onSelect={() => {
                setStatus(option);
                setFilterOpen(false);
              }}
            />
          ))}
          {showProjects ? (
            <>
              <div className="dd-menu-section">Project</div>
              {[{ id: '', name: 'All projects' }, { id: GLOBAL_ONLY, name: 'Global docs' }, ...projects].map((option) => (
                <MenuItem
                  key={option.id || 'all'}
                  label={option.name}
                  checked={option.id === projectFilter}
                  onSelect={() => {
                    setProjectFilter(option.id);
                    setFilterOpen(false);
                  }}
                />
              ))}
            </>
          ) : null}
        </Popover>
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
            onSelect={() => onSelect(doc.id)}
          />
        ))}
      </div>
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
  const projectList = projects.data ?? [];

  return (
    <div className="dd-root dd-workbench">
      <DocList
        projectId={variant === 'project' ? projectId : null}
        showProjects={variant === 'global'}
        projects={projectList}
        activeId={location.docId}
        onSelect={(docId) => onLocationChange({ docId, path: null })}
        onNew={() => setCreating({ template: null })}
        headerActions={headerActions}
      />
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
