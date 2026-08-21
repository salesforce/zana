// @ts-nocheck
import { ipcMain } from 'electron';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { ctx } from './ctx.js';
import type { LibraryAddInput, LibraryDoc, LibraryScope, SavedRecord, SavedRecordInput } from '@zana-ai/zcc-domain/product';

export function registerSavedIpc(): void {
  

  // Saved reports: save/list/delete RPCs + full-list change pushes. The save
  // onError returns null so a failed write surfaces as a toast in the renderer
  // rather than throwing across IPC (the bridge type is SavedRecord | null).
  ctx.safeHandle(
    IPC.saved.save,
    (input: SavedRecordInput) => ctx.savedStore.save(input),
    () => null
  );
  ctx.safeHandle(IPC.saved.list, () => ctx.savedStore.list(), () => []);
  ctx.safeHandle(
    IPC.saved.delete,
    (id: string) => ctx.savedStore.delete(id),
    () => false
  );
  ctx.savedStore.onChanged((records: SavedRecord[]) => {
    ctx.safeSend(IPC.saved.onChanged, records);
  });

  // Library: add/list/update/remove/reveal RPCs + full-list change pushes.
  ctx.safeHandle(IPC.library.list, () => ctx.libraryStore.list(), () => []);
  ctx.safeHandle(
    IPC.library.add,
    (input: LibraryAddInput) => ctx.libraryStore.add(input),
    () => null
  );
  ctx.safeHandle(
    IPC.library.update,
    (id: string, patch: Partial<Pick<LibraryDoc, 'title' | 'summary' | 'tags'>>) =>
      ctx.libraryStore.update(id, patch),
    () => null
  );
  ctx.safeHandle(
    IPC.library.remove,
    (id: string) => ctx.libraryStore.remove(id),
    () => false
  );
  ctx.safeHandle(
    IPC.library.reveal,
    (scope: LibraryScope, projectId?: string) => ctx.libraryStore.revealDir(scope, projectId),
    () => ({ ok: false, path: '', message: 'Reveal failed' })
  );
  ctx.safeHandle(
    IPC.library.search,
    (query: string) => ctx.libraryStore.search(query),
    () => ({ hits: [], truncated: false })
  );
  // Read/write a library doc's content by SCOPE + relPath (not an absolute
  // path). Global docs live in `~/.zcc/library`, outside any registered project,
  // so the generic project-confined fs.readFile/writeFile rejects them; these
  // seams confine to the scope's own library dir instead (CLAUDE.md #1/#2 — main
  // resolves the trusted dir from the scope, the renderer never passes an abspath).
  ctx.safeHandle(
    IPC.library.read,
    (scope: LibraryScope, relPath: string, projectId?: string) =>
      ctx.libraryStore.readContent(scope, relPath, projectId),
    () => ({ ok: false, message: 'Read failed' })
  );
  ctx.safeHandle(
    IPC.library.write,
    (scope: LibraryScope, relPath: string, content: string, projectId?: string) =>
      ctx.libraryStore.writeContent(scope, relPath, content, projectId),
    () => ({ ok: false, message: 'Write failed' })
  );
  // Folder-tree CRUD (createFolder/move/delete) — the full-library explorer's
  // New folder / rename-move / delete actions. Same scope-confined trust model
  // as read/write above.
  ctx.safeHandle(
    IPC.library.createFolder,
    (scope: LibraryScope, relPath: string, projectId?: string) =>
      ctx.libraryStore.createFolder(scope, relPath, projectId),
    () => ({ ok: false, message: 'Create folder failed' })
  );
  ctx.safeHandle(
    IPC.library.move,
    (
      from: { scope: LibraryScope; relPath: string; projectId?: string },
      to: { scope: LibraryScope; relPath: string; projectId?: string }
    ) => ctx.libraryStore.moveEntry(from, to),
    () => ({ ok: false, message: 'Move failed' })
  );
  ctx.safeHandle(
    IPC.library.deleteEntry,
    (scope: LibraryScope, relPath: string, projectId?: string) =>
      ctx.libraryStore.deleteEntry(scope, relPath, projectId),
    () => ({ ok: false, message: 'Delete failed' })
  );
  ctx.libraryStore.onChanged(() => {
    const docs = ctx.libraryStore.list();
    ctx.safeSend(IPC.library.onChanged, docs);
  });
}

