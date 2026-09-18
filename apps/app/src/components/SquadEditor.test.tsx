import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Team } from '@zana-ai/zcc-domain/product';
import { SquadEditor } from '@/components/SquadEditor';

const team: Team = {
  id: 'builtin:review-squad',
  name: 'Review Squad',
  description: 'An orchestrator plus workers.',
  orchestratorPersonaId: 'p-orch',
  slots: [
    { personaId: 'p-orch', quantity: 1, label: 'Controller' },
    { personaId: 'p-worker', quantity: 2, label: 'Worker' }
  ],
  source: 'builtin'
};

describe('SquadEditor orchestrator badge (read-only view)', () => {
  it('marks the orchestrator slot with a gold crown badge carrying hovertext', () => {
    const html = renderToStaticMarkup(
      <SquadEditor team={team} mode="view" onClose={vi.fn()} />
    );
    // One shared badge treatment: class + label + styled tooltip (crown icon renders as svg).
    // Native `title` does not render in the Electron build, so hovertext rides the
    // app's `.composer-control-tooltip` + `data-tooltip` bubble instead.
    expect(html).toContain('team-slot-orch-badge');
    expect(html).toContain('Orchestrator');
    expect(html).toContain('composer-control-tooltip');
    expect(html).toContain('data-tooltip="Orchestrator — launched first"');
  });

  it('does not badge a non-orchestrator slot', () => {
    const soloWorker: Team = { ...team, orchestratorPersonaId: undefined };
    const html = renderToStaticMarkup(
      <SquadEditor team={soloWorker} mode="view" onClose={vi.fn()} />
    );
    expect(html).not.toContain('team-slot-orch-badge');
  });

  it('counts the injected standalone orchestrator in the tab total', () => {
    // A squad may name an orchestrator persona that is NOT among its worker slots;
    // the view injects it as a crowned row (launch gives it its own tab). The
    // heading must count that injected row too, so rows and tab total agree.
    const standalone: Team = {
      ...team,
      orchestratorPersonaId: 'p-orch',
      slots: [{ personaId: 'p-worker', quantity: 2, label: 'Worker' }]
    };
    const html = renderToStaticMarkup(
      <SquadEditor team={standalone} mode="view" onClose={vi.fn()} />
    );
    // 2 workers + 1 injected orchestrator = 3 tabs (not the 2 that team.slots alone implies).
    expect(html).toContain('Slots — 3 tabs total');
    expect(html).toContain('team-slot-orch-badge');
  });
});

describe('SquadEditor orchestrator toggle (edit form)', () => {
  it('exposes a labeled crown toggle with hovertext on each slot', () => {
    const html = renderToStaticMarkup(
      <SquadEditor team={team} mode="edit" onClose={vi.fn()} />
    );
    expect(html).toContain('aria-label="Mark as orchestrator"');
    expect(html).toContain(
      'data-tooltip="Orchestrator — launched first, carries the opening prompt"'
    );
    // The orchestrator slot's toggle is pressed.
    expect(html).toContain('aria-pressed="true"');
  });
});

