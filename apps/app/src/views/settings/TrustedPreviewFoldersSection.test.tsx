// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const add = vi.fn();
const remove = vi.fn();
vi.mock('../../lib/product-client.js', () => ({
  product: { config: { addTrustedPreviewFolder: (...a: unknown[]) => add(...a), removeTrustedPreviewFolder: (...a: unknown[]) => remove(...a) } }
}));

import { TrustedPreviewFoldersSection } from './TrustedPreviewFoldersSection';

beforeEach(() => { add.mockReset(); remove.mockReset(); });
afterEach(cleanup);

describe('TrustedPreviewFoldersSection', () => {
  it('states the read-only, local-only scope and lists nothing by default', () => {
    render(<TrustedPreviewFoldersSection config={{}} />);
    expect(screen.getByText('Trusted Preview Folders')).toBeTruthy();
    expect(screen.getByText(/only to this local desktop/)).toBeTruthy();
    expect(screen.getByText(/read-only/)).toBeTruthy();
    expect(screen.getByText(/No trusted folders/)).toBeTruthy();
  });

  it('adds a folder through the chooser result', async () => {
    add.mockResolvedValue({ config: { trustedPreviewFolders: ['/Users/me/.claude/handoffs'] } });
    render(<TrustedPreviewFoldersSection config={{}} />);
    fireEvent.click(screen.getByRole('button', { name: /Add folder/ }));
    await waitFor(() => expect(screen.getByText('/Users/me/.claude/handoffs')).toBeTruthy());
    expect(add).toHaveBeenCalledWith();
  });

  it('leaves the list unchanged when the chooser is cancelled', async () => {
    add.mockResolvedValue({ config: null });
    render(<TrustedPreviewFoldersSection config={{ trustedPreviewFolders: ['/a'] }} />);
    fireEvent.click(screen.getByRole('button', { name: /Add folder/ }));
    await waitFor(() => expect(add).toHaveBeenCalled());
    expect(screen.getByText('/a')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a refusal such as the cap', async () => {
    add.mockResolvedValue({ config: null, error: 'At most 20 trusted preview folders are allowed.' });
    render(<TrustedPreviewFoldersSection config={{ trustedPreviewFolders: ['/a'] }} />);
    fireEvent.click(screen.getByRole('button', { name: /Add folder/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('At most 20');
  });

  it('shows a thrown failure', async () => {
    add.mockRejectedValue(new Error('boom'));
    render(<TrustedPreviewFoldersSection config={{}} />);
    fireEvent.click(screen.getByRole('button', { name: /Add folder/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('boom');
  });

  it('removes one root', async () => {
    remove.mockResolvedValue({ trustedPreviewFolders: ['/b'] });
    render(<TrustedPreviewFoldersSection config={{ trustedPreviewFolders: ['/a', '/b'] }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove /a' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('/a'));
    await waitFor(() => expect(screen.queryByText('/a')).toBeNull());
    expect(screen.getByText('/b')).toBeTruthy();
  });

  it('disables Add at the cap', () => {
    const many = Array.from({ length: 20 }, (_, i) => `/f${i}`);
    render(<TrustedPreviewFoldersSection config={{ trustedPreviewFolders: many }} />);
    expect((screen.getByRole('button', { name: /Add folder/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('follows authoritative config changes after a local edit', async () => {
    add.mockResolvedValue({ config: { trustedPreviewFolders: ['/a', '/b'] } });
    const view = render(<TrustedPreviewFoldersSection config={{ trustedPreviewFolders: ['/a'] }} />);
    fireEvent.click(screen.getByRole('button', { name: /Add folder/ }));
    await waitFor(() => expect(screen.getByText('/b')).toBeTruthy());
    view.rerender(<TrustedPreviewFoldersSection config={{ trustedPreviewFolders: ['/c'] }} />);
    await waitFor(() => expect(screen.getByText('/c')).toBeTruthy());
    expect(screen.queryByText('/b')).toBeNull();
  });
});
