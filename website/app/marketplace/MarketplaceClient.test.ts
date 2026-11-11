// @vitest-environment happy-dom
import { createElement, type ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('next/link', () => ({
  default: ({ children, ...props }: ComponentProps<'a'>) => createElement('a', props, children)
}));
import { MarketplaceClient } from './MarketplaceClient';

const plugin = (id: string, title: string, author = 'Zana') => ({
  id, displayName: title, description: `${title} description`, author: { name: author },
  source: { npm: { package: `@zana/${id}`, range: '1.2.3' } }
});

function renderClient() {
  return render(createElement(MarketplaceClient, { publicBaseUrl: 'https://example.test' }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('MarketplaceClient', () => {
  it('shows the live feed when the index is valid and filters cards by search', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ schemaVersion: 1, plugins: [plugin('alpha', 'Alpha'), plugin('beta', 'Beta')] })
    }));
    renderClient();
    await waitFor(() => expect(screen.getByText('live feed')).toBeTruthy());
    expect(screen.getByText('2 plugins')).toBeTruthy();
    expect(screen.getAllByText('1.2.3').length).toBe(2);
    expect(screen.getAllByText('by Zana').length).toBe(2);
    fireEvent.change(screen.getByLabelText('Search plugins'), { target: { value: 'beta' } });
    expect(screen.getByText('1 plugin')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search plugins'), { target: { value: 'nothing-matches' } });
    expect(screen.getByText(/No plugins match/)).toBeTruthy();
  });

  it('falls back to the bundled catalog when the feed is empty or unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ schemaVersion: 1, plugins: [] }) }));
    renderClient();
    await waitFor(() => expect(screen.getByText('bundled catalog')).toBeTruthy());
    cleanup();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    renderClient();
    await waitFor(() => expect(screen.getByText('bundled catalog')).toBeTruthy());
  });

  it('shows the connecting state first and ignores a response after unmount', async () => {
    let resolve!: (value: unknown) => void;
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise((r) => { resolve = r; })));
    const view = renderClient();
    expect(screen.getByText('connecting…')).toBeTruthy();
    view.unmount();
    resolve({ ok: true, json: async () => ({ schemaVersion: 1, plugins: [plugin('late', 'Late')] }) });
    await new Promise((r) => setTimeout(r, 0));
  });

  it('ignores a failed request after unmount', async () => {
    let reject!: (reason: unknown) => void;
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise((_, r) => { reject = r; })));
    const view = renderClient();
    view.unmount();
    reject(new Error('offline'));
    await new Promise((r) => setTimeout(r, 0));
  });
});
