import { useState, type ReactNode } from 'react';
import {
  callPluginRpc,
  useZccNavigate,
  type PluginMessageActionContext,
  type PluginMessageDirectiveProps,
  type PluginNavPanelProps,
  type PluginThreadPanelProps
} from '@zana-ai/zcc-plugin-sdk/app';
import { ArrowLeft, DraftingCompass, ExternalLink, Plus } from 'lucide-react';
import { PLUGIN_ID, type DesignDocSummary } from '../shared/contract.js';
import { DOC_PANEL_ACTION } from './Agents.js';
import { errorMessage, toast } from './api.js';
import { formatSubPath, parseSubPath, type DocLocation } from './content.js';
import { DocView } from './DocView.js';
import { useDoc, useDocs, useNow, usePersistentState, useProjects } from './hooks.js';
import { EmptyState, IconButton, Spinner, StatusPill, TimeAgo } from './ui.js';
import { NewDocDialog, Workbench } from './Workbench.js';

/** The nav panel's route segment (`/plugins/design-docs/<path>`). */
export const NAV_PATH = 'design-docs';

function Root({ children }: { children: ReactNode }) {
  return <div className="dd-root">{children}</div>;
}

export function NavPanel({ subPath }: PluginNavPanelProps) {
  const navigate = useZccNavigate();
  return (
    <Workbench
      variant="global"
      projectId={null}
      location={parseSubPath(subPath)}
      onLocationChange={(location, replace) => navigate.toPluginPanel(NAV_PATH, { subPath: formatSubPath(location), ...(replace ? { replace } : {}) })}
    />
  );
}

export function ProjectTab({ projectId, headerActions }: { pluginId: string; projectId: string; headerActions?: ReactNode }) {
  // A project tab has no URL of its own, so remember the open doc per project.
  const [stored, setStored] = usePersistentState<string>(`project-location:${projectId}`, '');
  return (
    <Workbench
      variant="project"
      projectId={projectId}
      location={parseSubPath(stored)}
      onLocationChange={(location: DocLocation) => setStored(formatSubPath(location))}
      headerActions={headerActions}
    />
  );
}

function openDoc(navigate: ReturnType<typeof useZccNavigate>, location: { docId: string; path: string | null }, title: string, threadId?: string) {
  const opened = navigate.openThreadPanel({
    actionId: DOC_PANEL_ACTION,
    title,
    params: { docId: location.docId, ...(location.path ? { path: location.path } : {}) },
    ...(threadId ? { threadId } : {})
  });
  if (!opened) navigate.toPluginPanel(NAV_PATH, { subPath: formatSubPath(location) });
}

/** `::design-doc{id="…" path="…"}` in a chat message. */
export function DirectiveCard({ attributes, source, message }: PluginMessageDirectiveProps) {
  const navigate = useZccNavigate();
  const id = attributes.id?.trim() || null;
  const path = attributes.path?.trim() || null;
  const doc = useDoc(id);
  if (!id || doc.error) {
    return (
      <div className="plugin-directive-card plugin-directive-card--error" role="alert" title={source}>
        {id ? `Design doc unavailable: ${doc.error}` : 'Invalid design doc link: an id is required.'}
      </div>
    );
  }
  const data = doc.data;
  return (
    <div className="plugin-directive-card dd-card">
      <button
        type="button"
        className="plugin-directive-card-main"
        disabled={!data}
        onClick={() => data && openDoc(navigate, { docId: data.id, path }, data.title, message.threadId)}
        title={data ? `Open ${data.title} beside this conversation` : undefined}
      >
        <span className="dd-card-icon" aria-hidden>
          <DraftingCompass size={14} />
        </span>
        <span className="plugin-directive-card-kind">Design doc</span>
        <span className="plugin-directive-card-title">{data ? data.title : 'Loading…'}</span>
        {data ? (
          <span className="plugin-directive-card-meta dd-card-meta">
            {path ? <code>{path}</code> : null}
            <StatusPill status={data.status} compact />
            {data.files.length} file{data.files.length === 1 ? '' : 's'}
            {data.openComments ? ` · ${data.openComments} open comment${data.openComments === 1 ? '' : 's'}` : ''}
          </span>
        ) : (
          <Spinner size={12} />
        )}
      </button>
      {data ? (
        <button
          type="button"
          className="plugin-directive-card-open"
          onClick={(event) => {
            event.stopPropagation();
            navigate.toPluginPanel(NAV_PATH, { subPath: formatSubPath({ docId: data.id, path }) });
          }}
          title="Open in Design Docs"
        >
          Open in Design Docs
        </button>
      ) : null}
    </div>
  );
}

function DocPicker({ projectId, onPick }: { projectId: string | null; onPick(docId: string): void }) {
  const docs = useDocs({ ...(projectId ? { projectId } : {}), status: 'active' });
  const projects = useProjects();
  const now = useNow();
  const [creating, setCreating] = useState(false);
  return (
    <div className="dd-picker">
      <div className="dd-picker-head">
        <span className="dd-list-title">Design docs</span>
        <span className="dd-spacer" />
        <button type="button" className="btn primary" onClick={() => setCreating(true)}>
          <Plus size={13} aria-hidden /> New
        </button>
      </div>
      <div className="dd-list-scroll">
        {!docs.data ? (
          <div className="dd-center">{docs.error ? <div className="dd-banner dd-banner-error">{docs.error}</div> : <Spinner />}</div>
        ) : docs.data.length ? (
          docs.data.map((doc: DesignDocSummary) => (
            <button key={doc.id} type="button" className="dd-doc-row" onClick={() => onPick(doc.id)}>
              <span className="dd-doc-row-top">
                <span className="dd-doc-row-title">{doc.title}</span>
                <StatusPill status={doc.status} compact />
              </span>
              {doc.summary ? <span className="dd-doc-row-summary">{doc.summary}</span> : null}
              <span className="dd-doc-row-meta">
                <span>{doc.fileCount} files</span>
                <span className="dd-spacer" />
                <TimeAgo at={doc.updatedAt} now={now} />
              </span>
            </button>
          ))
        ) : (
          <EmptyState icon={DraftingCompass} title="No design docs here yet">
            Create one, or ask this thread's agent to write a design doc. It will use the Design Docs tools.
          </EmptyState>
        )}
      </div>
      {creating ? (
        <NewDocDialog
          defaultProjectId={projectId}
          projects={projects.data ?? []}
          onClose={() => setCreating(false)}
          onCreated={(docId) => onPick(docId)}
        />
      ) : null}
    </div>
  );
}

function readParams(params: PluginThreadPanelProps['params']): { docId: string | null; path: string | null } {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return { docId: null, path: null };
  const record = params as Record<string, unknown>;
  return {
    docId: typeof record.docId === 'string' && record.docId ? record.docId : null,
    path: typeof record.path === 'string' && record.path ? record.path : null
  };
}

/**
 * The doc beside a conversation: watch an agent's edits land and review them.
 * The host reuses one panel across tabs, so a new doc in `params` starts fresh.
 */
export function ThreadPanel(props: PluginThreadPanelProps) {
  const { docId, path } = readParams(props.params);
  return <ThreadPanelBody key={`${docId}\u0000${path}`} {...props} />;
}

function ThreadPanelBody({ params, projectId }: PluginThreadPanelProps) {
  const navigate = useZccNavigate();
  const initial = readParams(params);
  const [location, setLocation] = useState(initial);
  const picked = !initial.docId;

  if (!location.docId) {
    return (
      <Root>
        <DocPicker projectId={projectId ?? null} onPick={(docId) => setLocation({ docId, path: null })} />
      </Root>
    );
  }
  const docId = location.docId;
  return (
    <Root>
      <DocView
        key={docId}
        docId={docId}
        path={location.path}
        layout="compact"
        contextProjectId={projectId ?? null}
        onOpenPath={(path) => setLocation({ docId, path })}
        onDeleted={() => setLocation({ docId: null, path: null })}
        headerExtra={
          <>
            {picked ? <IconButton icon={ArrowLeft} label="All design docs" onClick={() => setLocation({ docId: null, path: null })} /> : null}
            <IconButton
              icon={ExternalLink}
              label="Open in Design Docs"
              onClick={() => navigate.toPluginPanel(NAV_PATH, { subPath: formatSubPath(location) })}
            />
          </>
        }
      />
    </Root>
  );
}

/** "Save as design doc" on a chat message (or the selected part of it). */
export async function saveMessageAsDoc({ threadId, message, selectedText, openPanel }: PluginMessageActionContext): Promise<void> {
  const text = (selectedText?.trim() || message.text).trim();
  if (!text) {
    toast('This message has no text to save.', 'error');
    return;
  }
  try {
    const doc = (await callPluginRpc(PLUGIN_ID, 'createFromMessage', { threadId, text })) as DesignDocSummary;
    openPanel({ actionId: DOC_PANEL_ACTION, title: doc.title, params: { docId: doc.id } });
    toast(`Saved “${doc.title}” as a design doc`);
  } catch (error) {
    toast(`Could not save the design doc: ${errorMessage(error)}`, 'error');
  }
}
