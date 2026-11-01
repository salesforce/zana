// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChangesList } from './ChangesList.js';
import * as dragModule from '../../lib/fs-entry-drag.js';

afterEach(cleanup);

describe('ChangesList', () => {
  it('renders modified, added, and untracked files with names, dir paths, and badges', () => {
    const files = [
      { path: '/repo/src/index.ts', rel: 'src/index.ts', code: 'M' as const },
      { path: '/repo/new.txt', rel: 'new.txt', code: 'A' as const },
      { path: '/repo/temp.log', rel: 'temp.log', code: '?' as const },
      { path: '/repo/deleted.ts', rel: 'deleted.ts', code: 'D' as const },
      { path: '/repo/conflict.ts', rel: 'conflict.ts', code: 'C' as const }
    ];
    const onClick = vi.fn();
    const onDiscard = vi.fn();

    render(
      <ChangesList
        files={files}
        activeFile="/repo/src/index.ts"
        onClick={onClick}
        onDiscard={onDiscard}
      />
    );

    expect(screen.getByText('index.ts')).toBeTruthy();
    expect(screen.getByText('· src')).toBeTruthy();
    expect(screen.getByText('new.txt')).toBeTruthy();

    const activeRow = screen.getByTitle('Modified · src/index.ts');
    expect(activeRow.className).toContain('active');
    expect(activeRow.className).toContain('git-m');

    // Click file row
    fireEvent.click(activeRow);
    expect(onClick).toHaveBeenCalledWith('/repo/src/index.ts');

    // Discard button on modified file
    const discardMod = screen.getAllByRole('button', { name: 'Discard changes' })[0];
    fireEvent.click(discardMod);
    expect(onDiscard).toHaveBeenCalledWith('/repo/src/index.ts');

    // Delete button on added/untracked file
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete file' });
    expect(deleteButtons).toHaveLength(2);
    fireEvent.click(deleteButtons[0]);
    expect(onDiscard).toHaveBeenCalledWith('/repo/new.txt');
  });

  it('handles drag start, drag end, and drag click suppression', () => {
    const files = [{ path: '/repo/file.ts', rel: 'file.ts', code: 'M' as const }];
    const onClick = vi.fn();
    const onDiscard = vi.fn();

    const beginSpy = vi.spyOn(dragModule, 'beginFsEntryDrag').mockImplementation(() => {});
    const endSpy = vi.spyOn(dragModule, 'endFsEntryDrag').mockImplementation(() => {});

    render(
      <ChangesList
        files={files}
        activeFile={undefined}
        onClick={onClick}
        onDiscard={onDiscard}
      />
    );

    const row = screen.getByTitle('Modified · file.ts');
    fireEvent.dragStart(row, { dataTransfer: {} });
    expect(beginSpy).toHaveBeenCalledWith(expect.anything(), { path: '/repo/file.ts', kind: 'file' });

    fireEvent.dragEnd(row);
    expect(endSpy).toHaveBeenCalled();

    // Consume drag click
    vi.spyOn(dragModule, 'consumeFsEntryDragClick').mockReturnValueOnce(true);
    fireEvent.click(row);
    expect(onClick).not.toHaveBeenCalled();
  });
});
