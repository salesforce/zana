import React from 'react';
import { FileText, Undo2 } from 'lucide-react';
import type { GitFileCode } from '@zana-ai/zcc-domain/product';
import { beginFsEntryDrag, consumeFsEntryDragClick, endFsEntryDrag } from '../../lib/fs-entry-drag.js';

interface ChangesListProps {
  files: Array<{ path: string; rel: string; code: GitFileCode }>;
  activeFile: string | undefined;
  onClick: (path: string) => void;
  onDiscard: (path: string) => void;
}

const GIT_TITLES: Record<GitFileCode, string> = {
  M: 'Modified',
  A: 'Added',
  D: 'Deleted',
  R: 'Renamed',
  '?': 'Untracked',
  C: 'Conflict'
};

export const ChangesList = React.memo(function ChangesList({ files, activeFile, onClick, onDiscard }: ChangesListProps) {
  return (
    <>
      {files.map((f) => {
        const isActive = activeFile === f.path;
        const gitClass = `git-${f.code === '?' ? 'untracked' : f.code.toLowerCase()}`;
        const slash = f.rel.lastIndexOf('/');
        const dir = slash >= 0 ? f.rel.slice(0, slash) : '';
        const name = slash >= 0 ? f.rel.slice(slash + 1) : f.rel;
        const discardLabel = f.code === '?' || f.code === 'A' ? 'Delete file' : 'Discard changes';
        return (
          <div
            key={f.path}
            className={`tree-row file changes-row ${isActive ? 'active' : ''} ${gitClass}`}
            style={{ paddingLeft: 6 }}
            onClick={() => {
              if (consumeFsEntryDragClick()) return;
              onClick(f.path);
            }}
            title={`${GIT_TITLES[f.code]} · ${f.rel}`}
            draggable
            onDragStart={(e) => beginFsEntryDrag(e.dataTransfer, {
              path: f.path,
              kind: 'file'
            })}
            onDragEnd={endFsEntryDrag}
          >
            <span className="tree-chevron empty" />
            <span className="tree-icon">
              <FileText size={13} />
            </span>
            <span className="tree-name" title={f.rel}>
              {name}
              {dir && <span className="changes-row-dir"> · {dir}</span>}
            </span>
            <button
              type="button"
              className="changes-row-discard"
              title={discardLabel}
              aria-label={discardLabel}
              onClick={(e) => {
                e.stopPropagation();
                onDiscard(f.path);
              }}
            >
              <Undo2 size={12} />
            </button>
            <span className="tree-git-badge">{f.code}</span>
          </div>
        );
      })}
    </>
  );
});
