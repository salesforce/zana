/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Team } from '@zana-ai/zcc-domain/product';

const save = vi.hoisted(() => vi.fn());
vi.mock('../../lib/product-client.js', () => ({ product: { teams: { save: (...a: unknown[]) => save(...a), delete: vi.fn() } } }));
vi.mock('../../lib/native-capabilities.js', () => ({ nativeCapabilities: async () => ({ skills: [], commands: [], diagnostics: [] }) }));
vi.mock('../ImprovePromptButton.js', () => ({ ImprovePromptButton: () => null }));
vi.mock('../../store.js', () => {
  const state = {
    personas: [{ id: 'p-orch', name: 'Orch' }, { id: 'p-skilled', name: 'Skilled', skills: ['x'] }],
    projects: [], pushToast: vi.fn()
  };
  return {
    usePersonas: (sel: (s: unknown) => unknown) => sel(state),
    useData: (sel: (s: unknown) => unknown) => sel(state),
    useUi: (sel: (s: unknown) => unknown) => sel(state)
  };
});

import { SquadEditor } from '../SquadEditor.js';

const base: Team = {
  id: 'user:s', name: 'S', orchestratorPersonaId: 'p-orch', source: 'user',
  slots: [{ personaId: 'p-orch', quantity: 1 }, { personaId: 'p-skilled', quantity: 1 }]
};
afterEach(() => { cleanup(); save.mockReset(); });

const advanced = () => screen.getByTestId('team-advanced') as HTMLDetailsElement;

describe('Squad editor layout', () => {
  it('groups the form into Roster, Prompt & project, Worktree and Run limits sections', () => {
    render(<SquadEditor team={base} mode="edit" onClose={vi.fn()} />);
    const headings = Array.from(document.querySelectorAll('.team-editor-section')).map((h) => h.firstChild?.textContent?.trim());
    expect(headings).toEqual(['Roster', 'Prompt & project', 'Worktree', 'Run limits']);
  });

  it('keeps Advanced collapsed with a one-line summary of its settings', () => {
    render(<SquadEditor team={base} mode="edit" onClose={vi.fn()} />);
    expect(advanced().open).toBe(false);
    expect(screen.getByTestId('team-advanced-summary').textContent).toBe(
      'Routing: default · Lean workers: off · Keep orchestrator: off · Planning: default · Approval: Project'
    );
  });

  it('updates the Advanced summary as settings change', () => {
    render(<SquadEditor team={{ ...base, retainOrchestrator: true, routingEnforced: false }} mode="edit" onClose={vi.fn()} />);
    expect(screen.getByTestId('team-advanced-summary').textContent).toMatch(/Routing: off · .*Keep orchestrator: on/);
  });

  it('opens Advanced on its own when it holds a warning (lean workers with persona skills)', () => {
    render(<SquadEditor team={{ ...base, leanWorkers: true }} mode="edit" onClose={vi.fn()} />);
    expect(advanced().open).toBe(true);
    expect(screen.getByTestId('team-lean-persona-skills-notice')).toBeTruthy();
  });

  it('puts a How … is decided disclosure under each precedence-governed setting', () => {
    render(<SquadEditor team={base} mode="edit" onClose={vi.fn()} />);
    for (const t of ['How Isolation is decided', 'How Squad routing is decided', 'How worker skills are decided']) {
      expect(screen.getByText(t)).toBeTruthy();
    }
  });
});

describe('Squad editor run limits grid', () => {
  const lim = (n: RegExp) => screen.getByLabelText(n) as HTMLInputElement;

  it('labels each field with its unit, default and help text', () => {
    render(<SquadEditor team={base} mode="edit" onClose={vi.fn()} />);
    const ceiling = lim(/Output-only ceiling/);
    expect(ceiling.placeholder).toBe('30');
    expect(document.getElementById(ceiling.getAttribute('aria-describedby')!)!.textContent).toMatch(/Default 30/);
    expect(screen.getByTestId('team-run-limits').textContent).toMatch(/sessions/);
  });

  it('flags only the invalid field, shows an alert, and disables Save', () => {
    render(<SquadEditor team={base} mode="edit" onClose={vi.fn()} />);
    fireEvent.change(lim(/Output-only ceiling/), { target: { value: '0' } });
    expect(lim(/Output-only ceiling/).getAttribute('aria-invalid')).toBe('true');
    expect(lim(/Max sessions/).getAttribute('aria-invalid')).toBeNull();
    expect(screen.getByTestId('team-run-limits-error').textContent).toMatch(/Output-only ceiling must be whole minutes/);
    expect((screen.getByRole('button', { name: /Save/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(lim(/Output-only ceiling/), { target: { value: '' } });
    expect(lim(/Output-only ceiling/).getAttribute('aria-invalid')).toBeNull();
    expect((screen.getByRole('button', { name: /Save/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});
