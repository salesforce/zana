import type { WorkbenchView } from '../../lib/workbench-contract.js';

const VIEW_IDS: readonly WorkbenchView[] = ['overview', 'data', 'apex', 'deployments', 'agentforce'];
/** The Studio window keeps its own last view, so detaching does not move the main tab. */
export const projectViewStorageKey = (projectId: string, studio = false) => `salesforce:${studio ? 'studio-window' : 'project-tab'}:${projectId}`;

/**
 * The view last used in this project (untrusted storage: unknown values fall
 * back to Overview, or to Agentforce in the Studio window).
 */
export function readProjectView(projectId: string, studio = false): WorkbenchView {
  const fallback: WorkbenchView = studio ? 'agentforce' : 'overview';
  try {
    const stored = localStorage.getItem(projectViewStorageKey(projectId, studio));
    return VIEW_IDS.find(id => id === stored) ?? fallback;
  } catch { return fallback; }
}

/** Makes the next mount of the tab (or the Studio window) open on this view. */
export function rememberProjectView(projectId: string, view: WorkbenchView, studio = false): void {
  try { localStorage.setItem(projectViewStorageKey(projectId, studio), view); } catch { /* optional */ }
}
