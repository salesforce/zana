import { ChevronRight, ChevronDown, Folder, FolderOpen, FileText } from 'lucide-react';

import type { LibraryDoc } from '@zana-ai/zcc-domain/product';
import type { LibraryTreeNode } from '../libraryTree.js';

interface LibraryTreeRowsProps {
  nodes: LibraryTreeNode[];
  depth: number;
  expanded: Set<string>;
  selectedRelPath: string | undefined;
  selectedProjectId: string | undefined;
  onToggle: (key: string) => void;
  onSelect: (doc: LibraryDoc) => void;
  onContext: (e: React.MouseEvent, node: LibraryTreeNode) => void;
}

/**
 * Recursive folder-tree rows over a {@link LibraryTreeNode} tree — shared by
 * the global cross-project `LibraryPanel` and the per-project `LibraryView`
 * so the two surfaces render identically and stay in lockstep as the model
 * evolves. Twin of `explorer/TreeList.tsx`, but keyed on scope+relPath rather
 * than an absolute `FsEntry` path.
 */
export function LibraryTreeRows({
  nodes,
  depth,
  expanded,
  selectedRelPath,
  selectedProjectId,
  onToggle,
  onSelect,
  onContext
}: LibraryTreeRowsProps) {
  return (
    <>
      {nodes.map((node) => {
        const isDir = node.kind === 'dir';
        const isOpen = isDir && expanded.has(node.key);
        const isActive =
          !isDir && node.relPath === selectedRelPath && node.projectId === selectedProjectId;
        return (
          <div key={node.key}>
            <div
              className={`tree-row ${isDir ? 'dir' : 'file'} ${isActive ? 'active' : ''}`}
              style={{ paddingLeft: 6 + depth * 12 }}
              onClick={() => (isDir ? onToggle(node.key) : node.doc && onSelect(node.doc))}
              onContextMenu={(e) => onContext(e, node)}
              title={isDir ? node.name : node.doc?.summary ? `${node.name} — ${node.doc.summary}` : node.name}
            >
              <span className={`tree-chevron ${isDir ? '' : 'empty'}`}>
                {isDir && (isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
              </span>
              <span className="tree-icon">
                {isDir ? (
                  isOpen ? (
                    <FolderOpen size={13} />
                  ) : (
                    <Folder size={13} />
                  )
                ) : (
                  <FileText size={13} />
                )}
              </span>
              <span className="tree-name">{node.name}</span>
              {isDir && typeof node.count === 'number' && (
                <span className="library-tree-count">{node.count}</span>
              )}
            </div>
            {isDir && isOpen && node.children && node.children.length > 0 && (
              <LibraryTreeRows
                nodes={node.children}
                depth={depth + 1}
                expanded={expanded}
                selectedRelPath={selectedRelPath}
                selectedProjectId={selectedProjectId}
                onToggle={onToggle}
                onSelect={onSelect}
                onContext={onContext}
              />
            )}
          </div>
        );
      })}
    </>
  );
}
