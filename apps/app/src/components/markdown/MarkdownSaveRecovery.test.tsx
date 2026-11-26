// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MarkdownSaveRecovery } from './MarkdownSaveRecovery.js';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const latest = { ok: true, content: '# Latest', sha256: 'a'.repeat(64) };
it('reviews before accepting a revision and confirms before discarding a draft', async () => {
  const read = vi.fn(async () => latest); const use = vi.fn(); const discard = vi.fn();
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<MarkdownSaveRecovery message="Changed" read={read} onUseReviewed={use} onDiscard={discard} />);
  fireEvent.click(screen.getByText('Review latest version')); await screen.findByLabelText('Latest saved version');
  expect(read).toHaveBeenCalledOnce(); expect(use).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Use reviewed revision for next save')); expect(use).toHaveBeenCalledWith(latest);
  fireEvent.click(screen.getByText('Discard draft and use latest')); expect(discard).not.toHaveBeenCalled();
  confirm.mockReturnValue(true); fireEvent.click(screen.getByText('Discard draft and use latest')); expect(discard).toHaveBeenCalledWith(latest);
});
it.each([{ ok: false, message: 'offline' }, { ok: true, content: 'partial', truncated: true }, { ...latest, binary: true }, { ok: true, content: 'no revision' }])('keeps recovery closed for an incomplete or failed read', async result => {
  render(<MarkdownSaveRecovery message="Failed" read={async () => result} onUseReviewed={vi.fn()} onDiscard={vi.fn()} />);
  fireEvent.click(screen.getByText('Review latest version')); await screen.findByText(result.message ? /offline/ : /complete latest revision is unavailable/);
  expect(screen.queryByText('Use reviewed revision for next save')).toBeNull();
});
it('handles rejected reads and ignores results after unmount', async () => {
  const read = vi.fn().mockRejectedValueOnce(new Error('disconnected'));
  const view = render(<MarkdownSaveRecovery message="Failed" read={read} onUseReviewed={vi.fn()} onDiscard={vi.fn()} />);
  fireEvent.click(screen.getByText('Review latest version')); await screen.findByText(/disconnected/);
  let resolve!: (value: unknown) => void;
  read.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  fireEvent.click(screen.getByText('Review latest version')); view.unmount();
  await act(async () => { resolve(latest); });
});
