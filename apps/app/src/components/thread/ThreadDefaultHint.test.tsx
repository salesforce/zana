// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThreadDefaultHint } from './ThreadDefaultHint.js';
const mocks = vi.hoisted(() => ({ save: vi.fn(), mirror: vi.fn() }));
vi.mock('../../lib/product-client.js', () => ({ product: { config: { set: mocks.save } } }));
vi.mock('../../store.js', () => ({ useData: { setState: mocks.mirror } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const props = { providerId: 'custom', defaultProviderId: 'codex', source: 'global' as const, selectionSource: 'choice' as const, onUseDefault: vi.fn(), unavailable: false };
describe('ThreadDefaultHint', () => {
  it('distinguishes global, project and draft sources', () => {
    const view = render(<ThreadDefaultHint {...props} selectionSource="default" />);
    expect(screen.getByText('Global thread default')).toBeTruthy();
    view.rerender(<ThreadDefaultHint {...props} source="project" selectionSource="default" />);
    expect(screen.getByText('Project default')).toBeTruthy();
    view.rerender(<ThreadDefaultHint {...props} selectionSource="draft" />);
    expect(screen.getByText('Draft harness')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use default' }));
    expect(props.onUseDefault).toHaveBeenCalledOnce();
  });
  it('changes the global thread default only through the explicit action', async () => {
    mocks.save.mockResolvedValue({ defaultThreadProviderId: 'custom' });
    render(<ThreadDefaultHint {...props} />);
    expect(screen.getByText('This thread only')).toBeTruthy();
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Set as global thread default' }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ defaultThreadProviderId: 'custom' }));
    await waitFor(() => expect(mocks.mirror).toHaveBeenCalledWith({ defaultThreadProviderId: 'custom' }));
  });
  it('reports a failed save and does not offer unavailable or already-default providers', async () => {
    mocks.save.mockRejectedValue(new Error('write failed'));
    const view = render(<ThreadDefaultHint {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Set as global thread default' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Could not save');
    expect(mocks.mirror).not.toHaveBeenCalled();
    view.rerender(<ThreadDefaultHint {...props} unavailable />);
    expect(screen.queryByRole('button', { name: 'Set as global thread default' })).toBeNull();
    view.rerender(<ThreadDefaultHint {...props} providerId="codex" selectionSource="default" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
