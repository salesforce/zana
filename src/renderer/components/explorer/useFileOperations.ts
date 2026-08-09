import { useCallback } from 'react';
import type { OpenTarget } from '@shared/types';

interface UseFileOperationsProps {
  viewRoot: string;
  isRemote: boolean;
  projectId: string;
  pushToast: (message: string, type?: 'error') => void;
}

export function useFileOperations({ viewRoot, isRemote, projectId, pushToast }: UseFileOperationsProps) {
  const sendPathToTerminal = useCallback(async (path: string, getActiveTabId: () => string | undefined, setWorkspaceMode: (projectId: string, mode: 'terminals') => void) => {
    const activeTabId = getActiveTabId();
    if (!activeTabId) {
      pushToast('No active terminal in this project', 'error');
      return;
    }
    // Send the relative path when the file lives under the active root —
    // shorter, cleaner, and what Claude expects for @-mentions. Fall back
    // to absolute for paths outside (rare but possible via symlinks).
    const rel = path.startsWith(viewRoot + '/')
      ? path.slice(viewRoot.length + 1)
      : path;

    // posixQuote helper inline to avoid circular deps
    const posixQuote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

    try {
      await window.cc.terminals.write(activeTabId, posixQuote(rel) + ' ');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Failed to write to terminal', 'error');
      return;
    }
    setWorkspaceMode(projectId, 'terminals');
  }, [viewRoot, projectId, pushToast]);

  const copyPath = useCallback(async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      pushToast('Path copied');
    } catch {
      pushToast('Failed to copy path', 'error');
    }
  }, [pushToast]);

  const openInExternal = useCallback(async (target: OpenTarget, path: string) => {
    const r = await window.cc.openers.openIn(target, path);
    if (!r.ok) pushToast(r.message ?? `Failed to open in ${target}`, 'error');
  }, [pushToast]);

  const downloadRemoteFile = useCallback(async (path: string) => {
    const name = path.split('/').pop() ?? 'file';
    const r = await window.cc.fs.downloadFromRemote(projectId, path);
    if (r.canceled) return;
    if (!r.ok) {
      pushToast(r.message ?? `Failed to download ${name}`, 'error');
      return;
    }
    pushToast(`Downloaded ${name}`);
  }, [projectId, pushToast]);

  const uploadLocalFiles = useCallback(async (localPaths: string[], destDir: string, refreshDir: (dir: string) => Promise<void>) => {
    let any = false;
    for (const local of localPaths) {
      const name = local.split('/').pop() ?? 'file';
      const r = await window.cc.fs.uploadToRemote(projectId, local, destDir);
      if (r.ok) {
        any = true;
        pushToast(`Uploaded ${name}`);
      } else {
        pushToast(r.message ?? `Failed to upload ${name}`, 'error');
      }
    }
    // Uploads land in `<destDir>/.zcc-uploads/`; refresh destDir so the
    // (possibly new) staging folder appears, then reveal it.
    if (any) {
      await refreshDir(destDir);
      await refreshDir(destDir + '/.zcc-uploads');
    }
  }, [projectId, pushToast]);

  return {
    sendPathToTerminal,
    copyPath,
    openInExternal,
    downloadRemoteFile,
    uploadLocalFiles
  };
}
