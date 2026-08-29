import { copyText } from '../../../lib/copy-text.js';
import {
  activateClosableTab,
  addClosableTab,
  closeClosableTab,
  closeSecondaryPanel,
  openNewTab,
  openSecondaryPanel,
  patchClosableTab,
  selectPinnedView,
  setSecondaryPanelWidth,
  toggleSecondaryPanelMaximized,
  type ClosableSecondaryTab,
  type PinnedSecondaryView,
  type ThreadSecondaryPanelState
} from './threadSecondaryPanelState.js';

export { copyText };

export function environmentLabel(isWorktree: boolean, environmentName?: string | null): string {
  const named = environmentName?.trim();
  if (named) return named;
  return isWorktree ? 'This checkout' : 'Local';
}

export type ThreadSshStatus = 'checking' | 'connected' | 'unreachable';

export function sshTargetLabel(remote?: { host: string; user?: string } | null): string | null {
  const host = remote?.host?.trim();
  if (!host) return null;
  const user = remote?.user?.trim();
  return user ? `${user}@${host}` : host;
}

export function sshStatusText(status: ThreadSshStatus | null | undefined): string | null {
  if (status === 'connected') return 'Connected';
  if (status === 'unreachable') return 'Unreachable';
  if (status === 'checking') return 'Checking';
  return null;
}

export function sshRowValue(target: string, status: ThreadSshStatus | null | undefined): string {
  const label = sshStatusText(status);
  return label ? `${target} · ${label}` : target;
}

export function threadInfoEnvironmentLabel(
  isWorktree: boolean,
  environmentName: string | null | undefined,
  remoteToolProxy: boolean
): string {
  if (remoteToolProxy) return 'Local agent · remote tools';
  return environmentLabel(isWorktree, environmentName);
}

export const THREAD_INFO_FILE_PREVIEW_LIMIT = 12;

export function threadInfoGitSummary(
  label: string | null,
  fileCount: number,
  truncated = false
): string | null {
  if (!label) return null;
  if (fileCount <= 0) return label;
  const count = truncated ? `${fileCount}+` : String(fileCount);
  const noun = fileCount === 1 && !truncated ? 'file' : 'files';
  return `${label} · ${count} ${noun}`;
}

export function threadInfoFilePreview<T>(
  files: readonly T[],
  truncated = false,
  limit = THREAD_INFO_FILE_PREVIEW_LIMIT
): { files: T[]; extraLabel: string | null } {
  const shown = files.slice(0, limit);
  const extra = files.length - shown.length;
  if (truncated) return { files: shown, extraLabel: 'More changes…' };
  if (extra > 0) return { files: shown, extraLabel: `+${extra} more` };
  return { files: shown, extraLabel: null };
}

export async function hydrateRemoteToolProxyInfo(
  project: {
    id: string;
    remote?: { host: string; user?: string } | null;
    hostId?: string | null;
  } | null,
  deps: {
    remoteRoot: (id: string) => Promise<{ ok: boolean; root?: string; message?: string }>;
    executionHostId?: string | null;
  }
): Promise<{
  active: boolean;
  sshTarget: string | null;
  sshStatus: 'connected' | 'unreachable' | null;
  remoteDirectory: string | null;
}> {
  const empty = {
    active: false,
    sshTarget: null as string | null,
    sshStatus: null as 'connected' | 'unreachable' | null,
    remoteDirectory: null as string | null
  };
  if (!project?.remote) return empty;
  if (project.hostId && deps.executionHostId === project.hostId) return empty;
  const sshTarget = sshTargetLabel(project.remote);
  try {
    const root = await deps.remoteRoot(project.id);
    if (root.ok && root.root) {
      return { active: true, sshTarget, sshStatus: 'connected', remoteDirectory: root.root };
    }
    return { active: true, sshTarget, sshStatus: 'unreachable', remoteDirectory: null };
  } catch {
    return { active: true, sshTarget, sshStatus: 'unreachable', remoteDirectory: null };
  }
}

export function environmentNameFromList(
  environments: Array<{ id: string; name?: string | null }>,
  environmentId: string
): string | null {
  return environments.find((environment) => environment.id === environmentId)?.name ?? null;
}

export function normalizeBrowserUrl(next: string): string {
  return /^https?:\/\//i.test(next) ? next : `https://${next}`;
}

export function invokeWebviewMethod(
  view: { goBack?: () => void; goForward?: () => void; reload?: () => void } | null,
  method: 'goBack' | 'goForward' | 'reload'
): void {
  view?.[method]?.();
}

export function isPreviewImagePath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(path);
}

export function contentFromLocalRead(local: unknown): string | null {
  if (!local || typeof local !== 'object' || !('ok' in local)) return null;
  const result = local as { ok: boolean; content?: string };
  if (!result.ok) return null;
  return String(result.content ?? '');
}

export function previewKind(path: string, content: string): 'image' | 'text' {
  return isPreviewImagePath(path) && content.startsWith('data:') ? 'image' : 'text';
}

export function previewPathParts(path: string): { name: string; dir: string | null } {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/u, '');
  const cut = normalized.lastIndexOf('/');
  if (cut < 0) return { name: normalized || path, dir: null };
  const name = normalized.slice(cut + 1);
  const dir = normalized.slice(0, cut);
  return { name: name || path, dir: dir || null };
}

export function matchNewTabFiles(
  files: Array<{ path: string; rel?: string }>,
  query: string
): Array<{ path: string; rel?: string }> {
  const q = query.trim().toLowerCase();
  if (!q) return files.slice(0, 20);
  return files.filter((file) => {
    const hay = `${file.rel ?? ''} ${file.path}`.toLowerCase();
    return hay.includes(q);
  }).slice(0, 30);
}

export function newTabFileTitle(file: { path: string; rel?: string }): string {
  return file.rel ?? file.path.split('/').pop() ?? file.path;
}

export function widthFromPointer(
  clientX: number,
  box: { right: number; width: number }
): { widthPx: number; containerWidthPx: number } {
  return { widthPx: box.right - clientX, containerWidthPx: box.width };
}

export function commitBrowserUrl(next: string, apply: (url: string) => void): string {
  const url = normalizeBrowserUrl(next);
  apply(url);
  return url;
}

export function attachColumnResize(opts: {
  getBox: () => { right: number; width: number } | undefined;
  onResize: (widthPx: number, containerWidthPx: number) => void;
  addBodyClass: (name: string) => void;
  removeBodyClass: (name: string) => void;
  on: (type: 'mousemove' | 'mouseup', fn: (ev: { clientX: number }) => void) => void;
  off: (type: 'mousemove' | 'mouseup', fn: (ev: { clientX: number }) => void) => void;
}): void {
  const onMove = (ev: { clientX: number }) => {
    const box = opts.getBox();
    if (!box) return;
    const next = widthFromPointer(ev.clientX, box);
    opts.onResize(next.widthPx, next.containerWidthPx);
  };
  const onUp = () => {
    opts.off('mousemove', onMove);
    opts.off('mouseup', onUp);
    opts.removeBodyClass('resizing-col');
  };
  opts.addBodyClass('resizing-col');
  opts.on('mousemove', onMove);
  opts.on('mouseup', onUp);
}

export function shouldClearThreadPanelTerminal(
  current: { sessionId: string } | null | undefined,
  sessionId: string
): boolean {
  return current?.sessionId === sessionId;
}

export function applyIfCurrent<T>(cancelled: boolean, value: T, apply: (value: T) => void): void {
  if (!cancelled) apply(value);
}

export function applyPreviewResult(
  cancelled: boolean,
  result: { error: string } | { content: string },
  setError: (error: string) => void,
  setContent: (content: string) => void
): void {
  if (cancelled) return;
  if ('error' in result) setError(result.error);
  else setContent(result.content);
}

export function startColumnResize(
  event: { preventDefault: () => void },
  getParent: () => { getBoundingClientRect: () => { right: number; width: number } } | null | undefined,
  onResize: (widthPx: number, containerWidthPx: number) => void,
  addBodyClass: (name: string) => void,
  removeBodyClass: (name: string) => void,
  on: (type: 'mousemove' | 'mouseup', fn: (ev: { clientX: number }) => void) => void,
  off: (type: 'mousemove' | 'mouseup', fn: (ev: { clientX: number }) => void) => void
): void {
  event.preventDefault();
  const parent = getParent();
  attachColumnResize({
    getBox: () => parent?.getBoundingClientRect(),
    onResize,
    addBodyClass,
    removeBodyClass,
    on,
    off
  });
}

export function createSecondaryPanelCommands(
  update: (recipe: (current: ThreadSecondaryPanelState) => ThreadSecondaryPanelState) => void
) {
  return {
    open: () => update(openSecondaryPanel),
    close: () => update(closeSecondaryPanel),
    toggleMaximized: () => update(toggleSecondaryPanelMaximized),
    selectPin: (pin: PinnedSecondaryView) => update((current) => selectPinnedView(current, pin)),
    openNewTab: () => update(openNewTab),
    addTab: (tab: Omit<ClosableSecondaryTab, 'id'> & { id?: string }) => (
      update((current) => addClosableTab(current, tab))
    ),
    closeTab: (tabId: string) => update((current) => closeClosableTab(current, tabId)),
    activateTab: (tabId: string) => update((current) => activateClosableTab(current, tabId)),
    patchTab: (tabId: string, patch: Partial<Omit<ClosableSecondaryTab, 'id' | 'kind'>>) => (
      update((current) => patchClosableTab(current, tabId, patch))
    ),
    setWidth: (widthPx: number, containerWidthPx?: number) => (
      update((current) => setSecondaryPanelWidth(current, widthPx, containerWidthPx))
    )
  };
}

export async function loadEnvironmentName(
  list: (projectId: string) => Promise<Array<{ id: string; name?: string | null }>>,
  projectId: string,
  environmentId: string
): Promise<string | null> {
  try {
    return environmentNameFromList(await list(projectId), environmentId);
  } catch {
    return null;
  }
}

export async function loadWorkspaceMeta(
  status: (environmentId: string) => Promise<unknown>,
  pullRequest: (environmentId: string) => Promise<{ pullRequest?: unknown } | null>,
  environmentId: string
): Promise<{ status: unknown; pullRequest: unknown }> {
  const [nextStatus, pr] = await Promise.all([
    status(environmentId).catch(() => null),
    pullRequest(environmentId).catch(() => ({ pullRequest: null }))
  ]);
  return { status: nextStatus, pullRequest: pr?.pullRequest ?? null };
}

export async function loadFilePreview(
  readFile: (path: string) => Promise<unknown>,
  hostFileContent: ((threadId: string, path: string) => Promise<{ content: string }>) | undefined,
  threadId: string | undefined,
  path: string,
  options?: { skipLocal?: boolean }
): Promise<{ content: string } | { error: string }> {
  if (!options?.skipLocal) {
    try {
      const fromLocal = contentFromLocalRead(await readFile(path));
      if (fromLocal !== null) return { content: fromLocal };
    } catch {
      /* host */
    }
  }
  if (!threadId || typeof hostFileContent !== 'function') {
    return { error: 'Could not read file' };
  }
  try {
    const host = await hostFileContent(threadId, path);
    return { content: host.content };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not read file' };
  }
}

export async function loadWalkedFiles(
  walkFiles: ((root: string) => Promise<Array<{ path: string; rel?: string }>>) | undefined,
  root: string | null
): Promise<Array<{ path: string; rel?: string }>> {
  if (!root || typeof walkFiles !== 'function') return [];
  try {
    return await walkFiles(root);
  } catch {
    return [];
  }
}

export function onThreadPanelTerminalUnmount(
  current: { sessionId: string } | null | undefined,
  sessionId: string,
  clear: () => void
): void {
  if (shouldClearThreadPanelTerminal(current, sessionId)) clear();
}

export async function hydrateThreadInfo(
  projectId: string | null,
  _threadId: string,
  environmentId: string | null,
  deps: {
    listEnvironments: (projectId: string) => Promise<Array<{ id: string; name?: string | null }>>;
    status: (environmentId: string) => Promise<unknown>;
    pullRequest: (environmentId: string) => Promise<{ pullRequest?: unknown } | null>;
  }
): Promise<{
  environmentName: string | null;
  status: unknown;
  pullRequest: unknown;
}> {
  const environmentName = projectId && environmentId
    ? await loadEnvironmentName(deps.listEnvironments, projectId, environmentId)
    : null;
  const meta = environmentId
    ? await loadWorkspaceMeta(deps.status, deps.pullRequest, environmentId)
    : { status: null, pullRequest: null };
  return {
    environmentName,
    status: meta.status,
    pullRequest: meta.pullRequest
  };
}
