/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn();
const update = vi.fn();
const storeGoals: unknown[] = [];

vi.mock('../../lib/product-client.js', () => ({
  product: {
    goals: { create: (...args: unknown[]) => create(...args), update: (...args: unknown[]) => update(...args) },
    teams: { list: vi.fn(async () => [{ id: 'team-1', name: 'Release squad', slots: [] }]) }
  }
}));

vi.mock('@/store', () => ({
  useData: (selector: (state: { projects: Array<{ id: string; name: string }> }) => unknown) =>
    selector({ projects: [{ id: 'p1', name: 'Demo' }] }),
  useGoals: (selector: (state: { goals: never[]; loading: boolean }) => unknown) =>
    selector({ goals: storeGoals as never[], loading: false }),
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
        id === 'goal-plan-source'
          ? value === 'infer' ? 'provided' : 'infer'
          : id === 'goal-run-as'
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
    update.mockReset();
    storeGoals.length = 0;
  });

  const openNewSquad = async () => {
    render(<GoalsPanel />);
    fireEvent.click(screen.getAllByRole('button', { name: /New goal/ })[0]!);
    fireEvent.change(document.querySelector('#goal-title') as HTMLInputElement, { target: { value: 'Ship it' } });
    fireEvent.change(document.querySelector('#goal-statement') as HTMLTextAreaElement, { target: { value: 'Plan text' } });
    fireEvent.click(screen.getByLabelText('Run as'));
    await vi.waitFor(() => expect(screen.getByLabelText('Squad')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Squad'));
  };

  it('hides success criteria, relabels objective, shows planning chip for Squad', async () => {
    render(<GoalsPanel />);
    fireEvent.click(screen.getAllByRole('button', { name: /New goal/ })[0]!);
    expect(document.querySelector('#goal-criteria')).toBeTruthy();
    expect(screen.queryByLabelText('Squad planning')).toBeNull();
    expect(screen.getByText('Objective')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Run as'));
    await vi.waitFor(() => expect(screen.getByLabelText('Squad planning')).toBeTruthy());
    expect(document.querySelector('#goal-criteria')).toBeNull();
    expect(screen.getByText('Plan or prompt')).toBeTruthy();
    expect(screen.queryByText('Objective')).toBeNull();
  });

  it('passes default infer planSource and empty criteria for Squad create', async () => {
    create.mockResolvedValue({ ok: true, value: { id: 'g' } });
    await openNewSquad();
    fireEvent.click(screen.getByRole('button', { name: 'Create goal' }));
    await vi.waitFor(() => expect(create).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ planSource: 'infer', successCriteria: [] }));
  });

  it('passes provided planSource when chosen', async () => {
    create.mockResolvedValue({ ok: true, value: { id: 'g' } });
    await openNewSquad();
    fireEvent.click(screen.getByLabelText('Squad planning'));
    fireEvent.click(screen.getByRole('button', { name: 'Create goal' }));
    await vi.waitFor(() => expect(create).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ planSource: 'provided' }));
  });

  it('does not send planSource for Agent goals and keeps criteria', async () => {
    create.mockResolvedValue({ ok: true, value: { id: 'g' } });
    render(<GoalsPanel />);
    fireEvent.click(screen.getAllByRole('button', { name: /New goal/ })[0]!);
    fireEvent.change(document.querySelector('#goal-title') as HTMLInputElement, { target: { value: 'T' } });
    fireEvent.change(document.querySelector('#goal-statement') as HTMLTextAreaElement, { target: { value: 'S' } });
    fireEvent.change(document.querySelector('#goal-criteria') as HTMLTextAreaElement, { target: { value: 'a\nb' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create goal' }));
    await vi.waitFor(() => expect(create).toHaveBeenCalled());
    const input = create.mock.calls[0]![0] as Record<string, unknown>;
    expect('planSource' in input).toBe(false);
    expect(input.successCriteria).toEqual(['a', 'b']);
  });

  it('seeds planSource from existing Squad goal on edit and sends it on update', async () => {
    update.mockResolvedValue({ ok: true, value: { id: 'goal-9' } });
    storeGoals.push({
      id: 'goal-9', projectId: 'p1', title: 'Existing', statement: 'Plan', successCriteria: [],
      assignment: { kind: 'team', teamId: 'team-1' }, planSource: 'provided',
      status: 'draft', maxIterations: 10, noProgressLimit: 2, iterations: [], source: 'p1',
      createdAt: 1, updatedAt: 1
    });
    render(<GoalsPanel />);
    fireEvent.click(screen.getByLabelText('Toggle details'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]!);
    await vi.waitFor(() => expect(screen.getByLabelText('Squad planning').textContent).toBe('provided'));
    expect(document.querySelector('#goal-criteria')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await vi.waitFor(() => expect(update).toHaveBeenCalled());
    expect(update).toHaveBeenCalledWith('goal-9', expect.objectContaining({ planSource: 'provided', successCriteria: [] }));
  });

  it('shows a failed iteration launch error inline', () => {
    storeGoals.push({
      id: 'goal-8', projectId: 'p1', title: 'Broken', statement: 'Plan', successCriteria: [],
      assignment: { kind: 'team', teamId: 'team-1' }, planSource: 'provided',
      status: 'active', maxIterations: 10, noProgressLimit: 2, source: 'p1', createdAt: 1, updatedAt: 1,
      history: { retain: 20, iterations: [{ id: 'it-1', at: '2026-01-01T00:00:00.000Z', verdict: 'fail', error: 'Squad requirements are unavailable' }] }
    });
    render(<GoalsPanel />);
    fireEvent.click(screen.getByLabelText('Toggle details'));
    fireEvent.click(screen.getByRole('button', { name: 'View iteration error details' }));
    expect(within(screen.getByRole('dialog')).getByText('Squad requirements are unavailable')).toBeTruthy();
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
