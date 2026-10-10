/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn();

vi.mock('../../lib/product-client.js', () => ({
  product: {
    goals: { create: (...args: unknown[]) => create(...args) },
    teams: { list: vi.fn(async () => [{ id: 'team-1', name: 'Release squad', slots: [] }]) }
  }
}));

vi.mock('@/store', () => ({
  useData: (selector: (state: { projects: Array<{ id: string; name: string }> }) => unknown) =>
    selector({ projects: [{ id: 'p1', name: 'Demo' }] }),
  useGoals: (selector: (state: { goals: never[]; loading: boolean }) => unknown) =>
    selector({ goals: [], loading: false }),
  useUi: (selector: (state: { setNav: () => void; pushToast: () => void }) => unknown) =>
    selector({ setNav: () => {}, pushToast: () => {} })
}));

vi.mock('@/components/ImprovePromptButton', () => ({ ImprovePromptButton: () => null }));

vi.mock('@/components/ui/PopoverPicklist', () => ({
  PopoverPicklist: ({ id, value, onChange, ariaLabel }: { id: string; value: string; onChange: (value: string) => void; ariaLabel: string }) => (
    <button
      type="button"
      id={id}
      aria-label={ariaLabel}
      onClick={() => onChange(
        id === 'goal-run-as'
          ? value === 'agent' ? 'team' : 'agent'
          : id === 'goal-team' ? 'team-1' : value || 'p1'
      )}
    >
      {value || ariaLabel}
    </button>
  )
}));

import { GoalsPanel } from './GoalsPanel.js';

describe('GoalsPanel squad assignment', () => {
  afterEach(() => {
    cleanup();
    create.mockReset();
  });

  it('creates a goal assigned to an executable squad', async () => {
    create.mockResolvedValue({ ok: true, value: { id: 'goal-1' } });
    render(<GoalsPanel />);
    fireEvent.click(screen.getAllByRole('button', { name: /New goal/ })[0]!);
    fireEvent.change(document.querySelector('#goal-title') as HTMLInputElement, { target: { value: 'Ship it' } });
    fireEvent.change(document.querySelector('#goal-statement') as HTMLTextAreaElement, { target: { value: 'Release current change.' } });
    fireEvent.click(screen.getByLabelText('Run as'));
    await vi.waitFor(() => expect(screen.getByLabelText('Squad')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Squad'));
    fireEvent.click(screen.getByRole('button', { name: 'Create goal' }));
    await vi.waitFor(() => expect(create).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      assignment: { kind: 'team', teamId: 'team-1' }
    }));
  });

  it('shows launch profile only for Agent assignment across mode transitions', async () => {
    render(<GoalsPanel />);
    fireEvent.click(screen.getAllByRole('button', { name: /New goal/ })[0]!);
    expect(screen.getByLabelText('Launch profile')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Run as'));
    await vi.waitFor(() => expect(screen.getByLabelText('Squad')).toBeTruthy());
    expect(screen.queryByLabelText('Launch profile')).toBeNull();

    fireEvent.click(screen.getByLabelText('Run as'));
    await vi.waitFor(() => expect(screen.getByLabelText('Launch profile')).toBeTruthy());
    expect(screen.queryByLabelText('Squad')).toBeNull();
  });
});
