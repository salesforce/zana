// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThreadProviderDefaultField } from './ThreadProviderDefaultField.js';

afterEach(cleanup);
const providers = [
  { id: 'plugin-provider', displayName: 'Custom harness', pluginId: 'custom' },
  { id: 'offline', displayName: 'Offline', pluginId: 'custom', available: false }
];
describe('ThreadProviderDefaultField', () => {
  it('saves registered plugin ids and reports failed saves without changing the selected value', async () => {
    const save = vi.fn().mockRejectedValue(new Error('disk unavailable'));
    render(<ThreadProviderDefaultField value={null} providers={providers} onChange={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'Default for threads' }));
    expect((screen.getByRole('option', { name: 'Offline (unavailable)' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('option', { name: 'Custom harness' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('plugin-provider'));
    expect((await screen.findByRole('alert')).textContent).toContain('Could not save');
    expect(screen.getByRole('button', { name: 'Default for threads' }).textContent).toContain('Choose a harness');
  });
  it('keeps a removed provider visible and resets a project override to inheritance', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<ThreadProviderDefaultField value="removed" providers={providers} inherit="Codex" onChange={save} />);
    expect(screen.getByRole('button', { name: 'Default for threads' }).textContent).toContain('removed (unavailable)');
    fireEvent.click(screen.getByRole('button', { name: 'Default for threads' }));
    fireEvent.click(screen.getByRole('option', { name: 'Use global · Codex' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(null));
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('disables changes while registrations load or a save is pending', async () => {
    let resolve!: () => void;
    const save = vi.fn(() => new Promise<void>(done => { resolve = done; }));
    const view = render(<ThreadProviderDefaultField providers={providers} loading onChange={save} />);
    expect((screen.getByRole('button', { name: 'Default for threads' }) as HTMLButtonElement).disabled).toBe(true);
    view.rerender(<ThreadProviderDefaultField providers={providers} onChange={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'Default for threads' }));
    fireEvent.click(screen.getByRole('option', { name: 'Custom harness' }));
    expect((screen.getByRole('button', { name: 'Default for threads' }) as HTMLButtonElement).disabled).toBe(true);
    resolve();
    await waitFor(() => expect((screen.getByRole('button', { name: 'Default for threads' }) as HTMLButtonElement).disabled).toBe(false));
  });
});
