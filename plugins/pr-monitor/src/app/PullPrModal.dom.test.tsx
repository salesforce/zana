/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PullPrModal } from './PullPrModal.js';
import type { ModuleHost } from './host.js';

afterEach(cleanup);
const repo = { host: 'github.com', owner: 'acme', repo: 'app', shortHost: 'github', active: true, connection: 'connected' };
function mount(pull: () => Promise<unknown> = async () => ({ ok: true, prs: [] }), list: () => Promise<unknown> = async () => ({ ok: true, repos: [repo] })) {
  const call = vi.fn((method: string) => method === 'listRepos' ? list() : pull());
  const onPulled = vi.fn();
  const onClose = vi.fn();
  const view = render(<PullPrModal host={{ call } as unknown as ModuleHost} onClose={onClose} onPulled={onPulled} />);
  return { ...view, call, onPulled, onClose };
}

describe('Add PR dialog', () => {
  it('validates whole PR numbers, clears errors on edit and imports with Enter', async () => {
    const { call, onPulled } = mount();
    await waitFor(() => expect(screen.getByRole('spinbutton').hasAttribute('disabled')).toBe(false));
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '1.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add', exact: true }));
    expect(screen.getByRole('alert').textContent).toContain('valid PR number');
    expect(screen.getByRole('spinbutton').getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '42' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.keyDown(screen.getByRole('spinbutton'), { key: 'Enter' });
    await waitFor(() => expect(onPulled).toHaveBeenCalledWith([]));
    expect(call).toHaveBeenCalledWith('pullPr', { host: 'github.com', fullName: 'acme/app', number: 42 });
  });

  it.each([
    async () => ({ ok: false, error: 'PR not found' }),
    async () => { throw new Error('Offline'); },
    async () => ({ ok: false }),
  ])('surfaces failed imports and allows retry', async (pull) => {
    mount(pull);
    await waitFor(() => expect(screen.getByRole('spinbutton').hasAttribute('disabled')).toBe(false));
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '42' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add', exact: true }));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Add', exact: true }).hasAttribute('disabled')).toBe(false);
  });

  it('blocks closing and duplicate submission while an import is in progress', async () => {
    let resolve!: (value: unknown) => void;
    const { onClose, call } = mount(() => new Promise((done) => { resolve = done; }));
    await waitFor(() => expect(screen.getByRole('spinbutton').hasAttribute('disabled')).toBe(false));
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '42' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add', exact: true }));
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(screen.getByRole('spinbutton'), { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
    expect(call.mock.calls.filter(([method]) => method === 'pullPr')).toHaveLength(1);
    await act(async () => resolve({ ok: true, prs: [] }));
  });

  it('explains an empty repository list and filters disconnected or inactive repositories', async () => {
    mount(undefined, async () => ({ ok: true, repos: [{ ...repo, active: false }, { ...repo, connection: 'disconnected' }] }));
    await screen.findByText(/No connected repositories/);
    expect(screen.getByRole('button', { name: 'Add', exact: true }).hasAttribute('disabled')).toBe(true);
  });

  it('handles repository load failure and late completion after closing', async () => {
    const { unmount } = mount(undefined, async () => { throw new Error('Offline'); });
    await screen.findByText(/No connected repositories/);
    unmount();
    let resolve!: (value: unknown) => void;
    const late = mount(undefined, () => new Promise((done) => { resolve = done; }));
    late.unmount();
    await act(async () => resolve({ ok: true, repos: [repo] }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
