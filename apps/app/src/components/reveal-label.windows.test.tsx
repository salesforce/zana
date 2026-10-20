// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { FsEntry } from '@zana-ai/zcc-domain/product';

// Opener labels are read at module load, so pretend to be Windows before importing.
const h = vi.hoisted(() => {
  Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
  return { open: vi.fn(async () => ({ ok: true })), revealDir: vi.fn(async () => undefined), toast: vi.fn() };
});
vi.mock('../lib/product-client.js', () => ({ product: { openers: { openIn: h.open }, personas: { revealDir: h.revealDir } } }));
vi.mock('../store.js', () => ({
  useData: (selector: (state: unknown) => unknown) => selector({ openerHiddenTargets: [] }),
  useUi: (selector: (state: unknown) => unknown) => selector({ pushToast: h.toast })
}));

import { OpenerButtons } from './OpenerButtons.js';
import { ExplorerContextMenu } from './explorer/ExplorerContextMenu.js';
import { RevealPersonasButton } from './PersonaEditor.js';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Reveal labels on Windows', () => {
  it('names Explorer in the opener bar and still opens the finder target', () => {
    const path = 'C:\\work\\project';
    render(<OpenerButtons path={path} />);
    fireEvent.click(screen.getByTitle('Reveal in Explorer'));
    expect(h.open).toHaveBeenCalledWith('finder', path);
    expect(screen.queryByTitle('Reveal in Finder')).toBeNull();
  });

  it('names Explorer in the explorer context menu', () => {
    const reveal = vi.fn();
    const entry: FsEntry = { name: 'notes.md', path: 'C:\\work\\project\\notes.md', kind: 'file' } as FsEntry;
    render(
      <ExplorerContextMenu
        entry={entry}
        x={0}
        y={0}
        isRemote={false}
        onViewInEditor={vi.fn()}
        onSendToTerminal={vi.fn()}
        onRevealInFinder={reveal}
        onCopyPath={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reveal in Explorer' }));
    expect(reveal).toHaveBeenCalledOnce();
  });

  it('names Explorer on the personas folder button', () => {
    render(<RevealPersonasButton />);
    fireEvent.click(screen.getByTitle('Open the personas directory in Explorer'));
    expect(h.revealDir).toHaveBeenCalledOnce();
  });
});
