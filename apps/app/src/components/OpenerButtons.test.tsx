// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ open: vi.fn(), toast: vi.fn(), hidden: [] as string[] }));
vi.mock('../lib/product-client.js', () => ({ product: { openers: { openIn: h.open } } }));
vi.mock('../store.js', () => ({
  useUi: (selector: (state: unknown) => unknown) => selector({ pushToast: h.toast }),
  useData: (selector: (state: unknown) => unknown) => selector({ openerHiddenTargets: h.hidden })
}));

import { OpenerButtons } from './OpenerButtons.js';

const root = '/work/my project';
const file = `${root}/src/it’s here.ts`;
beforeEach(() => { vi.clearAllMocks(); h.hidden = []; h.open.mockResolvedValue({ ok: true }); });
afterEach(cleanup);

describe('OpenerButtons', () => {
  it.each([
    ['Open in Cursor', 'cursor'], ['Open in VS Code', 'code'], ['Open in IntelliJ IDEA', 'intellij']
  ])('%s opens the file inside its project', async (label, target) => {
    render(<OpenerButtons path={file} projectRoot={root} />);
    fireEvent.click(screen.getByTitle(label));
    await waitFor(() => expect(h.open).toHaveBeenCalledWith(target, file, { projectRoot: root }));
  });
  it.each([
    // The Reveal label names the platform's file manager.
    [/^Reveal in /, 'finder'], ['Open external Terminal', 'terminal']
  ])('%s keeps acting on the file path alone', async (label, target) => {
    render(<OpenerButtons path={file} projectRoot={root} />);
    fireEvent.click(screen.getByTitle(label));
    await waitFor(() => expect(h.open).toHaveBeenCalledWith(target, file));
  });
  it('opens just the path when no project is given', async () => {
    render(<OpenerButtons path={root} />);
    fireEvent.click(screen.getByTitle('Open in VS Code'));
    await waitFor(() => expect(h.open).toHaveBeenCalledWith('code', root));
  });
  it.each([
    [{ ok: false, message: 'Install Cursor' }, 'Install Cursor'],
    [{ ok: false }, 'Failed to open in cursor']
  ])('surfaces a failed launch: %j', async (result, message) => {
    h.open.mockResolvedValue(result);
    render(<OpenerButtons path={file} projectRoot={root} />);
    fireEvent.click(screen.getByTitle('Open in Cursor'));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(message, 'error'));
  });
  it('drops targets hidden in Settings', () => {
    h.hidden = ['intellij', 'terminal'];
    render(<OpenerButtons path={file} />);
    expect(screen.getAllByRole('button').map((b) => b.title)).toEqual(['Open in Cursor', 'Open in VS Code', expect.stringMatching(/^Reveal in /)]);
  });
});
