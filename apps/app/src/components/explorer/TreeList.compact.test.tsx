// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { FsEntry } from '@zana-ai/zcc-domain/product';
import { TreeList } from './TreeList.js';

afterEach(cleanup);

const dir = (path: string): FsEntry => ({ name: path.split('/').pop()!, kind: 'dir', path });
const file = (path: string): FsEntry => ({ name: path.split('/').pop()!, kind: 'file', path });

function renderTree(compact: boolean, extra: Partial<Record<string, FsEntry[]>> = {}) {
  const src = dir('/r/src');
  const main = dir('/r/src/main');
  const entries = new Map<string, FsEntry[]>([
    ['/r/src', [main]],
    ['/r/src/main', [file('/r/src/main/A.ts')]],
    ...Object.entries(extra).map(([k, v]) => [k, v!] as [string, FsEntry[]])
  ]);
  const onToggleDir = vi.fn();
  const onContext = vi.fn();
  const utils = render(
    <TreeList
      list={[src]}
      depth={0}
      expanded={new Map([['/r/src', true], ['/r/src/main', true]])}
      entries={entries}
      loading={new Set()}
      slow={new Set()}
      errors={new Map()}
      activeFile={undefined}
      gitFiles={undefined}
      dirtyDirs={new Set(['/r/src/main'])}
      compact={compact}
      onToggleDir={onToggleDir}
      onFileClick={() => {}}
      onContext={onContext}
    />
  );
  return { ...utils, onToggleDir, onContext };
}

describe('TreeList compact folders', () => {
  it('renders a single-child chain as one row targeting the last folder', () => {
    const { container, onToggleDir, onContext } = renderTree(true);
    const rows = container.querySelectorAll('.tree-row');
    expect(rows).toHaveLength(2);
    const row = rows[0] as HTMLElement;
    expect(row.textContent).toContain('src/main');
    expect(row.getAttribute('data-path')).toBe('/r/src/main');
    expect(row.classList.contains('git-dir-dirty')).toBe(true);
    fireEvent.click(row);
    expect(onToggleDir).toHaveBeenCalledWith(expect.objectContaining({ path: '/r/src/main' }));
    fireEvent.contextMenu(row);
    expect(onContext).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ path: '/r/src/main' }));
  });

  it('renders the plain nested tree when off', () => {
    const { container } = renderTree(false);
    const paths = [...container.querySelectorAll('.tree-row')].map((r) => r.getAttribute('data-path'));
    expect(paths).toEqual(['/r/src', '/r/src/main', '/r/src/main/A.ts']);
  });

  it('splits the chain when a sibling appears', () => {
    const { container } = renderTree(true, { '/r/src': [dir('/r/src/main'), dir('/r/src/test')] });
    const paths = [...container.querySelectorAll('.tree-row')].map((r) => r.getAttribute('data-path'));
    expect(paths[0]).toBe('/r/src');
    expect(paths).toContain('/r/src/main');
  });
});
