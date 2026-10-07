/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { Project } from '@zana-ai/zcc-domain/product';
import { ProjectSourcesSettings } from './ProjectSourcesSettings.js';

const mocks = vi.hoisted(() => ({
  apiJson: vi.fn(),
  hosts: [
    { id: 'h1', name: 'laptop', status: 'connected' },
    { id: 'h2', name: 'devbox', status: 'connected' },
    { id: 'h3', name: 'old-mac', status: 'offline' }
  ] as Array<{ id: string; name: string; status: string }>
}));
vi.mock('../../lib/fetch-with-app-surface.js', () => ({ apiJson: mocks.apiJson }));
vi.mock('../../hooks/useHosts.js', () => ({ useHosts: () => mocks.hosts }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const project = { id: 'p1' } as Project;
const sources = [
  { id: 'original:p1', hostId: 'h1', path: '/Users/me/zcc' },
  { id: 's2', hostId: 'h2', path: '/home/me/zcc' }
];

it('lists checkouts as rows with the original marked and others removable', async () => {
  mocks.apiJson.mockResolvedValue({ sources });
  const onSaved = vi.fn();
  const view = render(<ProjectSourcesSettings project={project} onSaved={onSaved} />);
  await view.findByText('/Users/me/zcc');
  const rows = view.container.querySelectorAll('.project-checkout-row');
  expect(rows).toHaveLength(2);
  expect(rows[0].textContent).toContain('laptop');
  expect(rows[0].querySelector('.settings-badge')?.textContent).toBe('Shared metadata');
  expect(rows[0].querySelector('.machine-status-dot--on')).not.toBeNull();
  expect(rows[1].querySelector('.settings-badge')).toBeNull();

  fireEvent.click(view.getByRole('button', { name: 'Remove' }));
  await waitFor(() => expect(mocks.apiJson).toHaveBeenCalledWith('/projects/p1/sources/s2', { method: 'DELETE', body: '{}' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
});

it('offers only machines without a checkout and adds a new one', async () => {
  mocks.apiJson.mockResolvedValue({ sources });
  const view = render(<ProjectSourcesSettings project={project} onSaved={vi.fn()} />);
  await view.findByText('/home/me/zcc');
  const select = view.getByLabelText('Checkout machine') as HTMLSelectElement;
  expect([...select.options].map(option => option.textContent)).toEqual(['Choose a machine', 'old-mac (offline)']);
  const add = view.getByRole('button', { name: 'Add checkout' }) as HTMLButtonElement;
  expect(add.disabled).toBe(true);

  mocks.hosts.push({ id: 'h4', name: 'server', status: 'connected' });
  view.rerender(<ProjectSourcesSettings project={project} onSaved={vi.fn()} />);
  fireEvent.change(view.getByLabelText('Checkout machine'), { target: { value: 'h4' } });
  fireEvent.change(view.getByLabelText('Checkout folder'), { target: { value: '/srv/zcc' } });
  expect(add.disabled).toBe(false);
  fireEvent.click(add);
  await waitFor(() => expect(mocks.apiJson).toHaveBeenCalledWith('/projects/p1/sources', {
    method: 'POST', body: JSON.stringify({ hostId: 'h4', path: '/srv/zcc' })
  }));
  mocks.hosts.pop();
});

it('disables the machine picker when every machine already has a checkout', async () => {
  mocks.apiJson.mockResolvedValue({ sources: [...sources, { id: 's3', hostId: 'h3', path: '/x' }] });
  const view = render(<ProjectSourcesSettings project={project} onSaved={vi.fn()} />);
  await view.findByText('/x');
  const select = view.getByLabelText('Checkout machine') as HTMLSelectElement;
  expect(select.disabled).toBe(true);
  expect(select.options[0].textContent).toBe('No other machines');
});

it('surfaces load and mutation errors', async () => {
  mocks.apiJson.mockRejectedValueOnce(new Error('boom'));
  const view = render(<ProjectSourcesSettings project={project} onSaved={vi.fn()} />);
  expect((await view.findByRole('alert')).textContent).toBe('boom');
});
