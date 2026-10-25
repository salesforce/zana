// @vitest-environment happy-dom
import { useRef, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project, WalkedFile } from '@zana-ai/zcc-domain/product';

const mocks = vi.hoisted(() => ({
  walkFiles: vi.fn(),
  setExplorerFile: vi.fn(),
  setProjectView: vi.fn()
}));
vi.mock('../lib/product-client.js', () => ({ product: { fs: { walkFiles: mocks.walkFiles } } }));
vi.mock('../store.js', () => {
  const uiState = {
    setExplorerFile: mocks.setExplorerFile,
    setProjectView: mocks.setProjectView,
    recentFiles: {}
  };
  const dataState = {
    explorerFileIconTheme: 'seti'
  };
  return {
    useUi: (select: (s: typeof uiState) => unknown) => select(uiState),
    useData: (select: (s: typeof dataState) => unknown) => select(dataState)
  };
});

import { QuickOpen } from './QuickOpen.js';
import { PaletteFrame, paletteOptionProps } from './palette/PaletteFrame.js';

afterEach(() => { cleanup(); vi.clearAllMocks(); document.body.replaceChildren(); });

let seq = 0;
function project(): Project {
  // A fresh root per test: QuickOpen caches walked files per project path.
  seq += 1;
  return { id: `p${seq}`, name: 'My App', path: `/work/my-app-${seq}` } as Project;
}

function file(rel: string, root: string): WalkedFile {
  return { path: `${root}/${rel}`, rel } as WalkedFile;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function opener() {
  const button = document.createElement('button');
  button.textContent = 'opener';
  document.body.appendChild(button);
  button.focus();
  return button;
}

describe('QuickOpen focus', () => {
  it('focuses the input on the first open while files are still indexing, and keeps typed text', async () => {
    const p = project();
    const walk = deferred<WalkedFile[]>();
    mocks.walkFiles.mockReturnValue(walk.promise);
    render(<QuickOpen project={p} onClose={vi.fn()} />);
    const input = screen.getByRole('textbox', { name: 'Find file in My App' }) as HTMLInputElement;
    expect(input.disabled).toBe(false);
    expect(document.activeElement).toBe(input);
    expect(input.placeholder).toBe('Indexing My App…');
    fireEvent.change(input, { target: { value: 'readme' } });
    await act(async () => { walk.resolve([file('src/index.ts', p.path), file('README.md', p.path)]); });
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('readme');
    // The match is highlighted with <mark>, so compare the rows' text.
    expect([...document.querySelectorAll('.palette-item')].map((row) => row.querySelector('.palette-label')?.textContent)).toEqual(['README.md']);
  });

  it('focuses the input when files come from the cache', async () => {
    const p = project();
    mocks.walkFiles.mockResolvedValue([file('a.ts', p.path)]);
    const first = render(<QuickOpen project={p} onClose={vi.fn()} />);
    await screen.findByRole('button', { name: 'a.ts' });
    first.unmount();
    render(<QuickOpen project={p} onClose={vi.fn()} />);
    expect(mocks.walkFiles).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Find file in My App' }));
  });
});

describe('QuickOpen Escape', () => {
  it('clears the query on the first Esc, closes on the second, and restores focus to the opener', async () => {
    const p = project();
    mocks.walkFiles.mockResolvedValue([file('a.ts', p.path)]);
    const back = opener();
    const windowEsc = vi.fn();
    window.addEventListener('keydown', windowEsc);
    const onClose = vi.fn();
    const view = render(<QuickOpen project={p} onClose={onClose} />);
    const input = screen.getByRole('textbox', { name: 'Find file in My App' }) as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: 'zzz' } });
    expect(await screen.findByText('No matches')).toBeTruthy();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('');
    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'a.ts' })).toBeTruthy();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    expect(windowEsc).not.toHaveBeenCalled();
    window.removeEventListener('keydown', windowEsc);

    view.unmount();
    expect(document.activeElement).toBe(back);
  });

  it('restores focus after a backdrop click', () => {
    const p = project();
    mocks.walkFiles.mockResolvedValue([]);
    const back = opener();
    const onClose = vi.fn();
    const view = render(<QuickOpen project={p} onClose={onClose} />);
    fireEvent.mouseDown(view.container.querySelector('.palette-backdrop')!);
    expect(onClose).toHaveBeenCalledOnce();
    view.unmount();
    expect(document.activeElement).toBe(back);
  });

  it('skips the restore when the opener is gone', () => {
    const p = project();
    mocks.walkFiles.mockResolvedValue([]);
    const back = opener();
    const view = render(<QuickOpen project={p} onClose={vi.fn()} />);
    fireEvent.mouseDown(view.container.querySelector('.palette-backdrop')!);
    back.remove();
    const focus = vi.spyOn(back, 'focus');
    view.unmount();
    expect(focus).not.toHaveBeenCalled();
  });

  it('does not restore focus when it unmounts without a dismissal', () => {
    // For example the selected project is removed while Quick Open is open.
    const p = project();
    mocks.walkFiles.mockResolvedValue([]);
    const back = opener();
    const focus = vi.spyOn(back, 'focus');
    const view = render(<QuickOpen project={p} onClose={vi.fn()} />);
    view.unmount();
    expect(focus).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(back);
  });
});

describe('QuickOpen from the command palette', () => {
  // `action:quick-open` closes the palette and opens Quick Open in one update,
  // so the palette's focus restore runs in the same commit as Quick Open's mount.
  function Host({ p }: { p: Project }) {
    const [quickOpen, setQuickOpen] = useState(false);
    const [palette, setPalette] = useState(true);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const findFile = () => { setPalette(false); setQuickOpen(true); };
    return (
      <>
        {palette && (
          <PaletteFrame query="" onQuery={vi.fn()} placeholder="Search" scope="all" onScope={vi.fn()}
            activeIndex={0} rowCount={1} total={1} inputRef={inputRef} listRef={listRef}
            onInputKeyDown={(e) => { if (e.key === 'Enter') findFile(); }} onClose={() => setPalette(false)}>
            <button {...paletteOptionProps(0, 0)}>Find file</button>
          </PaletteFrame>
        )}
        {quickOpen && <QuickOpen project={p} onClose={() => setQuickOpen(false)} />}
      </>
    );
  }

  it('focuses the input after the palette closes, and Esc returns focus to the element before the palette', async () => {
    const p = project();
    mocks.walkFiles.mockResolvedValue([file('a.ts', p.path)]);
    const back = opener();
    render(<Host p={p} />);
    const paletteInput = screen.getByRole('combobox', { name: 'Search commands and destinations' });
    expect(document.activeElement).toBe(paletteInput);

    fireEvent.keyDown(paletteInput, { key: 'Enter' });
    const input = screen.getByRole('textbox', { name: 'Find file in My App' }) as HTMLInputElement;
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: 'a' } });
    expect(input.value).toBe('a');

    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Find file in My App' })).toBeNull();
    expect(document.activeElement).toBe(back);
  });
});

describe('QuickOpen choose', () => {
  it('opens the chosen file in the explorer and leaves focus with it', async () => {
    const p = project();
    mocks.walkFiles.mockResolvedValue([file('src/a.ts', p.path), file('src/b.ts', p.path)]);
    const back = opener();
    const onClose = vi.fn();
    const view = render(<QuickOpen project={p} onClose={onClose} />);
    const input = screen.getByRole('textbox', { name: 'Find file in My App' });
    await screen.findByRole('button', { name: 'src/b.ts' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mocks.setProjectView).toHaveBeenCalledWith(p.id, 'explorer');
    expect(mocks.setExplorerFile).toHaveBeenCalledWith(p.id, `${p.path}/src/b.ts`);
    expect(onClose).toHaveBeenCalledOnce();
    view.unmount();
    expect(document.activeElement).not.toBe(back);
  });

  it('shows an empty list when indexing fails', async () => {
    mocks.walkFiles.mockRejectedValue(new Error('walk failed'));
    render(<QuickOpen project={project()} onClose={vi.fn()} />);
    expect(await screen.findByText('No matches')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Find file in My App' }).getAttribute('placeholder')).toBe('Find file in My App (0)');
  });
});
