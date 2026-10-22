// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Team } from '@zana-ai/zcc-domain/product';
import { SquadEditor } from '@/components/SquadEditor';

const mocks = vi.hoisted(() => ({
  save: vi.fn()
}));
vi.mock('../lib/product-client.js', () => ({ product: { teams: { save: mocks.save, delete: vi.fn() } } }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const team: Team = {
  id: 'user:s1',
  name: 'Squad',
  orchestratorPersonaId: 'p-orch',
  slots: [{ personaId: 'p-orch', quantity: 1 }],
  source: 'user'
};

it('saves the transport chosen in the selector', async () => {
  mocks.save.mockResolvedValue({ ok: true, value: { ...team, transport: 'MODERN' } });
  const onClose = vi.fn();
  render(<SquadEditor team={team} mode="edit" onClose={onClose} />);
  const select = screen.getByLabelText('Squad transport') as HTMLSelectElement;
  expect(select.value).toBe('CLI');
  fireEvent.change(select, { target: { value: 'MODERN' } });
  expect(select.value).toBe('MODERN');
  fireEvent.click(screen.getByRole('button', { name: /^save/i }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ transport: 'MODERN' })));
});

it('labels the squad detail header with the transport pill its members carry', () => {
  const { container, unmount } = render(<SquadEditor team={team} mode="view" onClose={vi.fn()} />);
  expect(container.querySelector('.modal-header .fleet-kind-chip')?.textContent).toBe('CLI Agent');
  unmount();
  const modern = render(<SquadEditor team={{ ...team, transport: 'MODERN' }} mode="view" onClose={vi.fn()} />);
  const chip = modern.container.querySelector('.modal-header .fleet-kind-chip');
  expect(chip?.getAttribute('data-kind')).toBe('thread');
  expect(chip?.textContent).toBe('Modern');
});
