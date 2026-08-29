// @ts-nocheck
import { ipcMain } from 'electron';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { ctx } from './ctx.js';
import { rejectRoot, trustedProjectRoot } from './shared.js';
import { verifyEditors } from '@zana-ai/zcc-server/services/projects/editor-verify';
import { confine, createDir as fsCreateDir, createFile as fsCreateFile, deletePath as fsDelete, readFile as fsReadFile, renamePath as fsRename, resolveDoc as fsResolveDoc, writeFile as fsWriteFile, listDir, readDataUrl, searchFiles, walkFiles } from '@zana-ai/zcc-server/services/projects/fs';
import { commitProjectChanges, discardChanges, getGitStatus, gitCommonDir, isGitRepo, listBranches, listWorktrees, previewProjectCommit, pushProjectBranch, removeWorktree, showHead, withWorktreeLock } from '@zana-ai/zcc-server/services/projects/git';
import { createDirRemote as fsCreateDirRemote, createFileRemote as fsCreateFileRemote, deleteRemote as fsDeleteRemote, listDirRemote as fsListDirRemote, readFileRemote as fsReadFileRemote, remoteRoot as fsRemoteRoot, renameRemote as fsRenameRemote, writeFileRemote as fsWriteFileRemote } from '@zana-ai/zcc-host-daemon/remote-fs';
import { downloadFromRemote as fsDownloadFromRemote, uploadToRemote as fsUploadToRemote } from '@zana-ai/zcc-host-daemon/remote-transfer';
import { store, worktreeRoot } from '@zana-ai/zcc-server/services/projects/store';
import { openIn } from '../native/openers.js';
import { isWithin } from '@zana-ai/zcc-path-confine';
import { BrowserWindow, clipboard, dialog } from 'electron';
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { basename, isAbsolute } from 'node:path';
import type { FsMutateResult, OpenTarget, ProjectRemote, SearchOptions } from '@zana-ai/zcc-domain/product';

export function registerFsIpc(): void {
  
  ctx.safeHandle(
    IPC.fs.createFile,
    async (root: string, p: string) => {
      const r = await trustedProjectRoot(root);
      return r ? fsCreateFile(r, p) : rejectRoot();
    },
    () => ({ ok: false, message: 'Create failed' })
  );
  ctx.safeHandle(
    IPC.fs.createDir,
    async (root: string, p: string) => {
      const r = await trustedProjectRoot(root);
      return r ? fsCreateDir(r, p) : rejectRoot();
    },
    () => ({ ok: false, message: 'Create failed' })
  );
  ctx.safeHandle(
    IPC.fs.rename,
    async (root: string, from: string, to: string) => {
      const r = await trustedProjectRoot(root);
      return r ? fsRename(r, from, to) : rejectRoot();
    },
    () => ({ ok: false, message: 'Rename failed' })
  );
  ctx.safeHandle(
    IPC.fs.delete,
    async (root: string, p: string) => {
      const r = await trustedProjectRoot(root);
      return r ? fsDelete(r, p) : rejectRoot();
    },
    () => ({ ok: false, message: 'Delete failed' })
  );
  // Reads (listDir / readFile) confine to a trusted root the same way the
  // mutating ops do (CLAUDE.md #1/#2 — main authorizes, renderer paths are
  // advisory). Every local read surface (Explorer, InboxDetail, the VS Code
  // provider) targets a registered project or a worktree of one, so we resolve
  // the target's enclosing trusted project root and reject anything that
  // realpath-escapes it. Without this, a renderer- or agent-supplied path like
  // `<project>/../../.ssh/id_rsa` (e.g. an inbox doc whose `path` traverses out)
  // would be read straight off disk. `confine` resolves symlinks on the parent
  // chain so an in-project symlink pointing outside is also rejected.
  const trustedReadPath = async (p: string): Promise<string | null> => {
    if (!p || typeof p !== 'string' || !isAbsolute(p)) return null;
    const projects = store.listProjects().filter((proj) => !proj.remote);
    // Try each registered (local) project root, plus any worktree linked to it,
    // as a confinement anchor. `confine` returns the normalized real path when
    // `p` sits inside; the first anchor that accepts it wins.
    for (const proj of projects) {
      const c = confine(proj.path, p);
      if (c.ok) return c.path;
      for (const wt of await listWorktrees(proj.path)) {
        const cw = confine(wt.path, p);
        if (cw.ok) return cw.path;
      }
    }
    return null;
  };
  // File attachments begin with a native chooser controlled by main. The
  // renderer receives only paths the user explicitly picked, never an arbitrary
  // renderer-supplied disk location.
  ctx.safeHandle(
    IPC.fs.pickFiles,
    async (): Promise<string[]> => {
      const win = BrowserWindow.getFocusedWindow() ?? ctx.mainWindow();
      if (!win) return [];
      const pick = await dialog.showOpenDialog(win, {
        title: 'Attach files to the agent task',
        properties: ['openFile', 'multiSelections']
      });
      return pick.canceled ? [] : pick.filePaths;
    },
    () => []
  );
  ctx.safeHandle(
    IPC.fs.listDir,
    async (p: string) => {
      const real = await trustedReadPath(p);
      return real ? listDir(real) : [];
    },
    () => []
  );
  ctx.safeHandle(
    IPC.fs.readFile,
    async (p: string) => {
      const real = await trustedReadPath(p);
      return real ? fsReadFile(real) : { ok: false, message: 'Path is not inside a known project' };
    },
    () => ({ ok: false, message: 'Read failed' })
  );
  // Writes confine to a trusted root the same way reads do (CLAUDE.md #1/#2 —
  // main authorizes, the renderer path is advisory). Without this, a buggy or
  // compromised renderer could overwrite any existing regular file the user can
  // write (~/.ssh/config, ~/.aws/credentials, ~/.zcc/*): `fsWriteFile`'s own
  // "must be a regular file" check is a sanity guard, NOT a confinement.
  ctx.safeHandle(
    IPC.fs.writeFile,
    async (p: string, content: string) => {
      const real = await trustedReadPath(p);
      return real ? fsWriteFile(real, content) : { ok: false, message: 'Path is not inside a known project' };
    },
    () => ({ ok: false, message: 'Write failed' })
  );
  // Resolve an inbox doc whose reported path doesn't exist under the project
  // root (the agent wrote it in a subdir or the library, then reported it
  // relative to that subdir). The renderer-supplied `root` and `originCwd` are
  // advisory — we confine `root` to a registered project first (Rule 1/2), and
  // `resolveDoc` itself confine()s every candidate (incl. originCwd) to that
  // trusted root, so the returned rel path is always inside the tree.
  ctx.safeHandle(
    IPC.fs.resolveDoc,
    async (root: string, reportedPath: string, originCwd?: string) => {
      if (!reportedPath || typeof reportedPath !== 'string') {
        return { ok: false, message: 'No path given' };
      }
      const realRoot = await trustedProjectRoot(root);
      if (!realRoot) return { ok: false, message: 'Path is not inside a known project' };
      const found = fsResolveDoc(
        realRoot,
        reportedPath,
        typeof originCwd === 'string' && originCwd ? originCwd : undefined
      );
      if (!found.ok) return { ok: false, message: 'File not found in this project' };
      const cleanReported = reportedPath.replace(/^[/\\]+/, '');
      return { ok: true, rel: found.rel, relocated: found.rel !== cleanReported };
    },
    () => ({ ok: false, message: 'Resolve failed' })
  );
  // walkFiles/searchFiles enumerate a tree (and searchFiles returns matched file
  // CONTENTS), so an unconfined path lets the renderer walk/grep arbitrary disk.
  // Confine the walk root to a registered project (or worktree of one) the same
  // way the read ops do — callers pass `project.path`.
  ctx.safeHandle(
    IPC.fs.walkFiles,
    async (p: string) => {
      const real = await trustedReadPath(p);
      return real ? walkFiles(real) : [];
    },
    () => []
  );
  ctx.safeHandle(
    IPC.fs.searchFiles,
    async (p: string, q: string, opts?: SearchOptions) => {
      const real = await trustedReadPath(p);
      return real ? searchFiles(real, q, opts) : { hits: [], scanned: 0, truncated: false };
    },
    () => ({ hits: [], scanned: 0, truncated: false })
  );

  // --- Remote (SSH) file browsing -------------------------------------------
  //
  // The renderer passes only a projectId; the host/user/start-path come from
  // the STORE (CLAUDE.md #1 — the renderer is untrusted, main authorizes). We
  // resolve each remote project's browse root once and cache it, then confine
  // every list/read under it inside remote-fs. Returns null when the project
  // isn't a known remote project so callers get a clean rejection.
  const remoteFor = (projectId: string): ProjectRemote | null => {
    const project = store.listProjects().find((p) => p.id === projectId);
    return project?.remote ?? null;
  };
  // projectId → resolved remote root. Cleared lazily only by app restart; a
  // remote project's start path is immutable for its lifetime, so caching the
  // realpath is safe and saves an ssh round-trip on every tree expansion.
  const remoteRootCache = new Map<string, string>();
  const resolveRemoteRoot = async (projectId: string): Promise<string | null> => {
    const cached = remoteRootCache.get(projectId);
    if (cached) return cached;
    const remote = remoteFor(projectId);
    if (!remote) return null;
    const res = await fsRemoteRoot(remote, store.getConfig().remoteDefaultPath);
    if (!res.ok || !res.root) return null;
    remoteRootCache.set(projectId, res.root);
    return res.root;
  };
  ctx.safeHandle(
    IPC.fs.remoteRoot,
    async (projectId: string) => {
      const remote = remoteFor(projectId);
      if (!remote) return { ok: false, message: 'Not a remote project' };
      const res = await fsRemoteRoot(remote, store.getConfig().remoteDefaultPath);
      if (res.ok && res.root) remoteRootCache.set(projectId, res.root);
      return res;
    },
    () => ({ ok: false, message: 'Failed to resolve remote root' })
  );
  ctx.safeHandle(
    IPC.fs.listDirRemote,
    async (projectId: string, p: string) => {
      const remote = remoteFor(projectId);
      const root = remote ? await resolveRemoteRoot(projectId) : null;
      if (!remote || !root) return [];
      return fsListDirRemote(remote, root, p);
    },
    () => []
  );
  ctx.safeHandle(
    IPC.fs.readFileRemote,
    async (projectId: string, p: string) => {
      const remote = remoteFor(projectId);
      const root = remote ? await resolveRemoteRoot(projectId) : null;
      if (!remote || !root) return { ok: false, message: 'Not a remote project' };
      return fsReadFileRemote(remote, root, p);
    },
    () => ({ ok: false, message: 'Remote read failed' })
  );
  // Remote mutations (Phase 2). Each resolves the remote config + root from the
  // store (never the renderer) and confines the path under the root inside
  // remote-fs. The `notRemote` reject keeps the error shape consistent with the
  // local mutate handlers.
  const notRemote = (): FsMutateResult => ({ ok: false, message: 'Not a remote project' });
  ctx.safeHandle(
    IPC.fs.writeFileRemote,
    async (projectId: string, p: string, content: string) => {
      const remote = remoteFor(projectId);
      const root = remote ? await resolveRemoteRoot(projectId) : null;
      if (!remote || !root) return { ok: false, message: 'Not a remote project' };
      return fsWriteFileRemote(remote, root, p, content);
    },
    () => ({ ok: false, message: 'Remote write failed' })
  );
  ctx.safeHandle(
    IPC.fs.createFileRemote,
    async (projectId: string, p: string) => {
      const remote = remoteFor(projectId);
      const root = remote ? await resolveRemoteRoot(projectId) : null;
      if (!remote || !root) return notRemote();
      return fsCreateFileRemote(remote, root, p);
    },
    () => ({ ok: false, message: 'Remote create failed' })
  );
  ctx.safeHandle(
    IPC.fs.createDirRemote,
    async (projectId: string, p: string) => {
      const remote = remoteFor(projectId);
      const root = remote ? await resolveRemoteRoot(projectId) : null;
      if (!remote || !root) return notRemote();
      return fsCreateDirRemote(remote, root, p);
    },
    () => ({ ok: false, message: 'Remote create failed' })
  );
  ctx.safeHandle(
    IPC.fs.renameRemote,
    async (projectId: string, from: string, to: string) => {
      const remote = remoteFor(projectId);
      const root = remote ? await resolveRemoteRoot(projectId) : null;
      if (!remote || !root) return notRemote();
      return fsRenameRemote(remote, root, from, to);
    },
    () => ({ ok: false, message: 'Remote rename failed' })
  );
  ctx.safeHandle(
    IPC.fs.deleteRemote,
    async (projectId: string, p: string) => {
      const remote = remoteFor(projectId);
      const root = remote ? await resolveRemoteRoot(projectId) : null;
      if (!remote || !root) return notRemote();
      return fsDeleteRemote(remote, root, p);
    },
    () => ({ ok: false, message: 'Remote delete failed' })
  );
  // Transfers: stream a local file up to the remote, or pull a remote file down
  // through an OS save dialog. Both resolve remote+root from the store and
  // confine the remote side under the root (inside remote-transfer).
  ctx.safeHandle(
    IPC.fs.uploadToRemote,
    async (projectId: string, localPath: string, destDir: string) => {
      const remote = remoteFor(projectId);
      const root = remote ? await resolveRemoteRoot(projectId) : null;
      if (!remote || !root) return { ok: false, message: 'Not a remote project' };
      // The renderer's session cwd may retain the configured remote start path,
      // while `root` is its physical (`pwd -P`) path. Always stage relative
      // drops at the canonical root so no renderer-provided path can broaden
      // the transfer's trust boundary.
      return fsUploadToRemote(remote, root, localPath, destDir === '.' ? root : destDir);
    },
    () => ({ ok: false, message: 'Upload failed' })
  );
  ctx.safeHandle(
    IPC.fs.downloadFromRemote,
    async (projectId: string, remotePath: string) => {
      const remote = remoteFor(projectId);
      const root = remote ? await resolveRemoteRoot(projectId) : null;
      if (!remote || !root) return { ok: false, message: 'Not a remote project' };
      const win = ctx.mainWindow();
      if (!win) return { ok: false, message: 'No window' };
      const result = await dialog.showSaveDialog(win, {
        defaultPath: basename(remotePath)
      });
      if (result.canceled || !result.filePath) return { ok: true, canceled: true };
      return fsDownloadFromRemote(remote, root, remotePath, result.filePath);
    },
    () => ({ ok: false, message: 'Download failed' })
  );
  ctx.safeHandle(
    IPC.openers.openIn,
    (target: OpenTarget, p: string) => {
      // Resolve the user's per-editor / terminal overrides from main's own
      // config (Rule 1 — never a renderer-supplied binary path).
      const cfg = store.getConfig();
      return openIn(target, p, {
        cursorBinary: cfg.editorCursorBinary,
        cursorApp: cfg.editorCursorApp,
        codeBinary: cfg.editorCodeBinary,
        codeApp: cfg.editorCodeApp,
        intellijBinary: cfg.editorIntellijBinary,
        intellijApp: cfg.editorIntellijApp,
        terminalApp: cfg.terminalApp
      });
    },
    () => ({ ok: false, message: 'Open failed' })
  );
  ctx.safeHandle(
    IPC.clipboard.writeText,
    (text: string) => {
      clipboard.writeText(text);
      return { ok: true };
    },
    () => ({ ok: false })
  );
  // External-editor verification (Settings → Editor). Probes each editor's
  // resolved `<shim> --version` best-effort against main's own config (Rule 1).
  ctx.safeHandle(
    IPC.editor.verify,
    () => verifyEditors(store.getConfig()),
    () => []
  );
  ctx.safeHandle(
    IPC.git.status,
    (p: string, scope?: string[] | null) => getGitStatus(p, scope),
    () => null
  );
  ctx.safeHandle(IPC.git.showHead, (p: string) => showHead(p), () => ({ ok: false, message: 'git show failed' }));
  ctx.safeHandle(IPC.git.discard, (p: string) => discardChanges(p), () => ({ ok: false, message: 'git discard failed' }));
  const authorizedGitProject = (projectId: string) => {
    const project = store.listProjects().find((candidate) => candidate.id === projectId);
    if (!project || project.remote) return null;
    try {
      return { project, cwd: realpathSync(project.path) };
    } catch {
      return null;
    }
  };
  const gitCommitPreviews = new Map<string, { cwd: string; preview: import('@zana-ai/zcc-domain/product').GitCommitPreview }>();
  ctx.safeHandle(
    IPC.git.previewCommit,
    async (projectId: string) => {
      const authorized = authorizedGitProject(projectId);
      if (!authorized) return { ok: false as const, message: 'Unknown or unavailable local project.' };
      const id = randomUUID();
      const preview = await previewProjectCommit(authorized.cwd, projectId, id, Date.now() + 60_000);
      if (!preview) return { ok: false as const, message: 'There are no changes to commit.' };
      gitCommitPreviews.set(id, { cwd: authorized.cwd, preview });
      return { ok: true as const, value: preview };
    },
    () => ({ ok: false as const, message: 'Could not preview changes.' })
  );
  ctx.safeHandle(
    IPC.git.commitProject,
    async (previewId: string, message: string) => {
      const pending = gitCommitPreviews.get(previewId);
      gitCommitPreviews.delete(previewId);
      if (!pending || pending.preview.expiresAt < Date.now()) {
        return { ok: false, message: 'Commit preview expired or was already used. Review and confirm again.' };
      }
      const authorized = authorizedGitProject(pending.preview.projectId);
      if (!authorized || authorized.cwd !== pending.cwd) return { ok: false, message: 'Project is no longer available.' };
      return commitProjectChanges(pending.cwd, message, pending.preview);
    },
    () => ({ ok: false, message: 'Commit failed.' })
  );
  ctx.safeHandle(
    IPC.git.pushProject,
    async (projectId: string) => {
      const authorized = authorizedGitProject(projectId);
      if (!authorized) return { ok: false, message: 'Unknown or unavailable local project.' };
      return pushProjectBranch(authorized.cwd);
    },
    () => ({ ok: false, message: 'Push failed.' })
  );
  ctx.safeHandle(IPC.git.isRepo, (p: string) => isGitRepo(p), () => false);
  ctx.safeHandle(IPC.git.listWorktrees, (p: string) => listWorktrees(p), () => []);
  ctx.safeHandle(IPC.git.listBranches, (p: string) => listBranches(p), () => []);
  // Manual worktree removal (the Explorer's worktree switcher, and any future
  // management surface). main authorizes (Rule 1): the target must be a
  // registered project's path AND the worktree must realpath-resolve under the
  // app-managed `~/zcc-worktrees` root — we only ever prune worktrees WE minted,
  // never an arbitrary path the renderer names. Returns a shaped failure on any
  // rejection rather than throwing.
  ctx.safeHandle(
    IPC.git.removeWorktree,
    async (projectPath: string, worktreePath: string, force?: boolean) => {
      const project = store.listProjects().find((p) => p.path === projectPath);
      if (!project) return { ok: false, message: 'unknown project' };
      let realWt: string;
      try {
        realWt = realpathSync(worktreePath);
      } catch {
        return { ok: false, message: 'worktree not found' };
      }
      if (!isWithin(realWt, realpathSync(worktreeRoot()))) {
        return { ok: false, message: 'not a managed worktree' };
      }
      const common = await gitCommonDir(realWt);
      const projectCommon = await gitCommonDir(project.path);
      if (!common || !projectCommon || common !== projectCommon) {
        return { ok: false, message: 'worktree does not belong to this project' };
      }
      const branch = (await listWorktrees(project.path)).find((tree) => tree.path === realWt)?.branch;
      if (!branch) return { ok: false, message: 'worktree branch not found' };
      const res = await withWorktreeLock(project.path, branch, async () => {
        if (ctx.worktreeInUse(realWt)) {
          return { ok: false, message: 'worktree is in use by a live agent' };
        }
        return removeWorktree(project.path, realWt, !!force);
      });
      // Drop any cached exit-prune entry now that it's gone (a session may still
      // be live; its exit handler will just no-op on the missing entry).
      for (const [sid, rec] of ctx.worktreeBySession) {
        if (rec.worktree.path === realWt) ctx.worktreeBySession.delete(sid);
      }
      return res;
    },
    () => ({ ok: false, message: 'worktree remove failed' })
  );
  ctx.safeHandle(
    IPC.fs.readDataUrl,
    async (p: string) => {
      // Confine to a registered project (covers Explorer + project-scope library
      // assets) OR the global library dir (`~/.zcc/library`, outside any project
      // — backs global-scope LibraryView image previews). Rule 1/2.
      let real = await trustedReadPath(p);
      if (!real) {
        const c = confine(ctx.libraryStore.userDir(), p);
        if (c.ok) real = c.path;
      }
      return real ? readDataUrl(real) : { ok: false, message: 'Path is not inside a known project' };
    },
    () => ({ ok: false, message: 'Read failed' })
  );
}

