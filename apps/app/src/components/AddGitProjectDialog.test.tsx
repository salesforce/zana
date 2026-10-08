// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddGitProjectDialog } from './AddGitProjectDialog.js';

const mocks = vi.hoisted(() => ({
  cloneRoot: vi.fn().mockResolvedValue('/projects'),
  onCloneProgress: vi.fn(), off: vi.fn()
}));
vi.mock('../lib/product-client.js', () => ({ product: { projects: mocks } }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function open(onClone = vi.fn()) {
  mocks.onCloneProgress.mockReturnValue(mocks.off);
  const onSuccess = vi.fn(), onClose = vi.fn();
  render(<AddGitProjectDialog onClone={onClone} onSuccess={onSuccess} onClose={onClose} />);
  return { onClone, onSuccess, onClose };
}

describe('Git import dialog', () => {
  it('keeps inputs, shows account recovery and collapsed details, and supports retry', async () => {
    const onClone = vi.fn().mockResolvedValueOnce({ ok: false, code: 'CLONE_FAILED',
      message: 'remote: Repository not found.\nfatal: Authentication failed' });
    const { onSuccess, onClose } = open(onClone);
    fireEvent.change(screen.getByRole('textbox', { name: 'Repository URL' }), {
      target: { value: 'https://example.test/private/repo.git' }
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Project name' }), { target: { value: 'my-project' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clone & add' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Switch the account');
    expect(alert.querySelector('details')?.open).toBe(false);
    expect(alert.querySelector('pre')?.textContent).toContain('fatal: Authentication failed');
    expect((screen.getByRole('textbox', { name: 'Repository URL' }) as HTMLInputElement).value).toBe('https://example.test/private/repo.git');
    expect((screen.getByRole('textbox', { name: 'Project name' }) as HTMLInputElement).value).toBe('my-project');
    onClone.mockResolvedValueOnce({ ok: true, project: { id: 'new-project' } });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('new-project'));
    expect(onClone).toHaveBeenLastCalledWith({ url: 'https://example.test/private/repo.git', name: 'my-project' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('handles thrown errors and clears recovery when the URL is edited', async () => {
    open(vi.fn().mockRejectedValue(new Error('Failed to connect to example.test')));
    fireEvent.change(screen.getByRole('textbox', { name: 'Repository URL' }), { target: { value: 'owner/repo' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Repository URL' }), { key: 'Enter' });
    expect((await screen.findByRole('alert')).textContent).toContain('Check your internet connection');
    fireEvent.change(screen.getByRole('textbox', { name: 'Repository URL' }), { target: { value: 'owner/fixed-repo' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByRole('textbox', { name: 'Project name' }) as HTMLInputElement).value).toBe('fixed-repo');
  });

  it('disables controls while cloning, streams progress, and releases its subscription', async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise(resolveValue => { resolve = resolveValue; });
    open(vi.fn().mockReturnValue(pending));
    expect((screen.getByRole('button', { name: 'Clone & add' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: 'Repository URL' }), { target: { value: 'git@example.test:owner/repo.git' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clone & add' }));
    expect((screen.getByRole('button', { name: 'Cloning…' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => mocks.onCloneProgress.mock.calls[0][0]('Receiving objects: 20%'));
    expect(screen.getByText('Receiving objects: 20%')).toBeTruthy();
    await act(async () => resolve({ ok: false, code: 'DEST_EXISTS', message: 'clone target already exists' }));
    expect(screen.getByRole('alert').textContent).toContain('Rename the project');
    cleanup();
    expect(mocks.off).toHaveBeenCalledOnce();
  });
});
