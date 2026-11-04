import { useState } from 'react';
import { CloudUpload } from 'lucide-react';
import { useZccNavigate } from '@zana-ai/zcc-plugin-sdk/app';
import type { DesignDocDetail } from '../shared/contract.js';
import { MAX_BRANCH_LENGTH, MAX_REPO_URL_LENGTH, pagesUrl, parsePublishTarget, type PublishFolder } from '../shared/publish.js';
import { showDocAgent } from './Agents.js';
import { defaultAgentProject, errorMessage, toast, useApi } from './api.js';
import { useProjects } from './hooks.js';
import { Dialog, Spinner } from './ui.js';

interface SavedTarget {
  repo: string;
  branch: string;
  folder: PublishFolder;
}

const DEFAULT_TARGET: SavedTarget = { repo: '', branch: 'main', folder: 'root' };

/** Where this doc was last published from this machine, so publishing again is one click. */
const storageKey = (docId: string) => `zcc.design-docs.publish.${docId}`;

export function loadTarget(docId: string): SavedTarget {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(docId)) ?? 'null') as Partial<SavedTarget> | null;
    if (!saved) return DEFAULT_TARGET;
    return {
      repo: typeof saved.repo === 'string' ? saved.repo : '',
      branch: typeof saved.branch === 'string' && saved.branch ? saved.branch : DEFAULT_TARGET.branch,
      folder: saved.folder === 'docs' ? 'docs' : 'root'
    };
  } catch {
    return DEFAULT_TARGET;
  }
}

function saveTarget(docId: string, target: SavedTarget): void {
  try {
    localStorage.setItem(storageKey(docId), JSON.stringify(target));
  } catch {
    // Storage is a convenience; publishing works without it.
  }
}

function checkTarget(target: SavedTarget, ownRepo: boolean): string | null {
  try {
    parsePublishTarget({ ...target, repo: ownRepo ? '' : target.repo });
    return null;
  } catch (error) {
    return errorMessage(error);
  }
}

function PublishDialog({ doc, onClose }: { doc: DesignDocDetail; onClose(): void }) {
  const api = useApi();
  const navigate = useZccNavigate();
  const projects = useProjects();
  const [target, setTarget] = useState<SavedTarget>(() => loadTarget(doc.id));
  const [ownRepo, setOwnRepo] = useState(() => !loadTarget(doc.id).repo);
  const [projectId, setProjectId] = useState('');
  const [busy, setBusy] = useState(false);
  const needsProject = !doc.projectId;
  const projectOptions = projects.data ?? [];
  const chosenProject = needsProject ? projectId || defaultAgentProject(projectOptions) || '' : doc.projectId!;
  const hasPages = doc.files.some((file) => file.kind === 'html');
  const problem = !hasPages
    ? 'This doc has no HTML pages to publish. Add an index.html first.'
    : !ownRepo && !target.repo.trim()
      ? null
      : checkTarget(target, ownRepo);
  const ready = hasPages && !problem && (ownRepo || !!target.repo.trim()) && (!needsProject || !!chosenProject);
  const liveUrl = !ownRepo && !problem && target.repo.trim() ? pagesUrl(target.repo) : null;
  const set = (patch: Partial<SavedTarget>) => setTarget((current) => ({ ...current, ...patch }));

  const publish = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      const result = await api.publish(doc.id, {
        ...(ownRepo ? {} : { repo: target.repo.trim() }),
        branch: target.branch.trim(),
        folder: target.folder,
        ...(needsProject ? { projectId: chosenProject } : {})
      });
      saveTarget(doc.id, { ...target, repo: ownRepo ? '' : target.repo.trim(), branch: target.branch.trim() });
      showDocAgent(navigate, doc, result.threadId);
      toast(`Publishing “${doc.title}”. The agent reports the live URL when the push lands.`);
      onClose();
    } catch (error) {
      toast(`Could not start publishing: ${errorMessage(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Publish site"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={!ready || busy} onClick={() => void publish()}>
            {busy ? <Spinner size={12} /> : <CloudUpload size={13} aria-hidden />}
            Publish
          </button>
        </>
      }
    >
      <p className="dd-muted dd-publish-intro">
        An agent exports this doc as a static site, commits it and pushes it with your git credentials. GitHub Pages then serves it.
      </p>
      <div className="dd-publish-fields">
        <label className="dd-field">
          <span className="dd-field-label">Repository</span>
          <select className="dd-input dd-select" value={ownRepo ? 'own' : 'other'} onChange={(event) => setOwnRepo(event.target.value === 'own')}>
            <option value="own">This project's repository</option>
            <option value="other">Another repository…</option>
          </select>
        </label>
        {ownRepo ? null : (
          <label className="dd-field">
            <span className="dd-field-label">Clone URL</span>
            <input
              className="dd-input"
              value={target.repo}
              maxLength={MAX_REPO_URL_LENGTH}
              placeholder="https://github.com/owner/repo"
              spellCheck={false}
              autoFocus
              onChange={(event) => set({ repo: event.target.value })}
            />
          </label>
        )}
        <div className="dd-field-row">
          <label className="dd-field">
            <span className="dd-field-label">Branch</span>
            <input
              className="dd-input"
              value={target.branch}
              maxLength={MAX_BRANCH_LENGTH}
              spellCheck={false}
              onChange={(event) => set({ branch: event.target.value })}
            />
          </label>
          <label className="dd-field">
            <span className="dd-field-label">Folder</span>
            <select className="dd-input dd-select" value={target.folder} onChange={(event) => set({ folder: event.target.value as PublishFolder })}>
              <option value="root">/ (root)</option>
              <option value="docs">/docs</option>
            </select>
          </label>
        </div>
        {needsProject ? (
          <label className="dd-field">
            <span className="dd-field-label">Run the agent in</span>
            <select className="dd-input dd-select" value={chosenProject} onChange={(event) => setProjectId(event.target.value)}>
              {projectOptions.length ? null : <option value="">No projects</option>}
              {projectOptions.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {problem ? (
        <p className="dd-publish-problem" role="alert">
          {problem}
        </p>
      ) : (
        <p className="dd-muted dd-field-help">
          {liveUrl ? (
            <>
              Expected at <code>{liveUrl}</code>.{' '}
            </>
          ) : null}
          Turn on Pages in the repository settings once: deploy from <code>{target.branch.trim() || 'main'}</code>,{' '}
          <code>{target.folder === 'docs' ? '/docs' : '/ (root)'}</code>. Other files in the repository are left in place.
        </p>
      )}
    </Dialog>
  );
}

/** "Publish": exports the doc as a GitHub Pages site through an agent thread. */
export function PublishButton({ doc, compact = false }: { doc: DesignDocDetail; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn dd-publish-trigger"
        title="Publish as a GitHub Pages site"
        aria-label={compact ? 'Publish' : undefined}
        onClick={() => setOpen(true)}
      >
        <CloudUpload size={13} aria-hidden />
        {compact ? null : 'Publish'}
      </button>
      {open ? <PublishDialog doc={doc} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
