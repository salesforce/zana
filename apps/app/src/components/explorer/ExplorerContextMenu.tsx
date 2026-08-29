import React from 'react';
import type { FsEntry, GitFileCode } from '@zana-ai/zcc-domain/product';

interface ExplorerContextMenuProps {
  entry: FsEntry;
  x: number;
  y: number;
  isRemote: boolean;
  gitFiles?: Record<string, GitFileCode>;
  onViewInEditor: () => void;
  onSendToTerminal: () => void;
  onDownloadRemote?: () => void;
  onOpenInCursor?: () => void;
  onOpenInCode?: () => void;
  onRevealInFinder?: () => void;
  onCreateFile?: () => void;
  onCreateFolder?: () => void;
  onOpenShellHere?: () => void;
  onOpenInTerminal?: () => void;
  onCopyPath: () => void;
  onRename: () => void;
  onDiscardChanges?: () => void;
  onDelete: () => void;
}

export function ExplorerContextMenu({
  entry,
  x,
  y,
  isRemote,
  gitFiles,
  onViewInEditor,
  onSendToTerminal,
  onDownloadRemote,
  onOpenInCursor,
  onOpenInCode,
  onRevealInFinder,
  onCreateFile,
  onCreateFolder,
  onOpenShellHere,
  onOpenInTerminal,
  onCopyPath,
  onRename,
  onDiscardChanges,
  onDelete
}: ExplorerContextMenuProps) {
  const fileCode = entry.kind === 'file' && gitFiles ? gitFiles[entry.path] : undefined;

  return (
    <div
      className="tree-context-menu"
      style={{ top: y, left: x }}
      onClick={(e) => e.stopPropagation()}
    >
      {entry.kind === 'file' && (
        <button onClick={onViewInEditor}>
          View in editor
        </button>
      )}
      <button onClick={onSendToTerminal}>
        Send path to active terminal
      </button>
      {isRemote && entry.kind === 'file' && onDownloadRemote && (
        <button onClick={onDownloadRemote}>
          Download to this machine…
        </button>
      )}
      {/* The external-open actions launch LOCAL apps against a local path, so
          they're hidden for a remote project. Create / rename / delete are
          now plumbed over ssh (remote-fs Phase 2), so they stay available. */}
      {!isRemote && (
        <>
          {onOpenInCursor && (
            <button onClick={onOpenInCursor}>
              Open in Cursor
            </button>
          )}
          {onOpenInCode && (
            <button onClick={onOpenInCode}>
              Open in VS Code
            </button>
          )}
          {onRevealInFinder && (
            <button onClick={onRevealInFinder}>
              Reveal in Finder
            </button>
          )}
        </>
      )}
      {entry.kind === 'dir' && (
        <>
          {onCreateFile && (
            <button onClick={onCreateFile}>
              New file…
            </button>
          )}
          {onCreateFolder && (
            <button onClick={onCreateFolder}>
              New folder…
            </button>
          )}
          {!isRemote && (
            <>
              {onOpenShellHere && (
                <button onClick={onOpenShellHere}>
                  Open shell here
                </button>
              )}
              {onOpenInTerminal && (
                <button onClick={onOpenInTerminal}>
                  Open in external Terminal
                </button>
              )}
            </>
          )}
        </>
      )}
      <button onClick={onCopyPath}>
        Copy path
      </button>
      <button onClick={onRename}>
        Rename / move…
      </button>
      {!isRemote && entry.kind === 'file' && fileCode && onDiscardChanges && (
        <button
          className="danger"
          onClick={onDiscardChanges}
        >
          {fileCode === '?' || fileCode === 'A'
            ? 'Delete file'
            : 'Discard changes'}
        </button>
      )}
      <button
        className="danger"
        onClick={onDelete}
      >
        {entry.kind === 'dir' ? 'Delete folder' : 'Delete file'}
      </button>
    </div>
  );
}
