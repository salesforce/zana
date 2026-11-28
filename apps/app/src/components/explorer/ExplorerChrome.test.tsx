// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@zana-ai/zcc-domain/product';
import { ExplorerContextMenu } from './ExplorerContextMenu.js';
import { ExplorerTreeHeader } from './ExplorerTreeHeader.js';

afterEach(cleanup);
const project = { id: 'p', name: 'Proj', path: '/repo' } as Project;
const headerProps = {
  project, isRemote: false, treeMode: 'files' as const, changedFilesCount: 0,
  onTreeModeToggle: vi.fn(), onCreateFile: vi.fn(), onCreateFolder: vi.fn(), onRefresh: vi.fn()
};

describe('ExplorerTreeHeader collapse all', () => {
  it('calls onCollapseAll and not refresh', () => {
    const onCollapseAll = vi.fn();
    const onRefresh = vi.fn();
    render(<ExplorerTreeHeader {...headerProps} onRefresh={onRefresh} onCollapseAll={onCollapseAll} />);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all folders' }));
    expect(onCollapseAll).toHaveBeenCalledTimes(1);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('omits the button when no handler is given', () => {
    render(<ExplorerTreeHeader {...headerProps} />);
    expect(screen.queryByRole('button', { name: 'Collapse all folders' })).toBeNull();
  });
});

describe('ExplorerContextMenu copy relative path', () => {
  const base = {
    entry: { name: 'a.ts', path: '/repo/a.ts', kind: 'file' as const }, x: 0, y: 0, isRemote: false,
    onViewInEditor: vi.fn(), onSendToTerminal: vi.fn(), onCopyPath: vi.fn(), onRename: vi.fn(), onDelete: vi.fn()
  };

  it('shows and fires the relative-path action', () => {
    const onCopyRelativePath = vi.fn();
    render(<ExplorerContextMenu {...base} onCopyRelativePath={onCopyRelativePath} />);
    fireEvent.click(screen.getByText('Copy relative path'));
    expect(onCopyRelativePath).toHaveBeenCalledTimes(1);
  });

  it('hides it when no handler is given', () => {
    render(<ExplorerContextMenu {...base} />);
    expect(screen.queryByText('Copy relative path')).toBeNull();
  });
});
