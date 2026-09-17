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
    // One shared badge treatment: class + label + title (crown icon renders as svg).
    expect(html).toContain('team-slot-orch-badge');
    expect(html).toContain('Orchestrator');
    expect(html).toContain('title="Orchestrator — launched first"');
  });

  it('does not badge a non-orchestrator slot', () => {
    const soloWorker: Team = { ...team, orchestratorPersonaId: undefined };
    const html = renderToStaticMarkup(
      <SquadEditor team={soloWorker} mode="view" onClose={vi.fn()} />
    );
    expect(html).not.toContain('team-slot-orch-badge');
  });
});

describe('SquadEditor orchestrator toggle (edit form)', () => {
  it('exposes a labeled crown toggle with hovertext on each slot', () => {
    const html = renderToStaticMarkup(
      <SquadEditor team={team} mode="edit" onClose={vi.fn()} />
    );
    expect(html).toContain('aria-label="Mark as orchestrator"');
    expect(html).toContain(
      'title="Orchestrator — launched first, carries the opening prompt"'
    );
    // The orchestrator slot's toggle is pressed.
    expect(html).toContain('aria-pressed="true"');
  });
});

describe('SquadEditor per-team overrides (edit form)', () => {
  it('renders both override toggles OFF by default, hiding their inputs', () => {
    const html = renderToStaticMarkup(
      <SquadEditor team={team} mode="edit" onClose={vi.fn()} />
    );
    expect(html).toContain('Override disabled orchestrator MCP servers');
    expect(html).toContain('Override plan startup grace (seconds)');
    // No override on this team → checkboxes unchecked, so their inputs are not rendered.
    expect(html).not.toContain('aria-label="Team orchestrator MCP server denylist"');
    expect(html).not.toContain('aria-label="Team plan startup grace (seconds)"');
  });

  it('pre-checks a team that carries overrides and shows the stored values', () => {
    const overridden: Team = {
      ...team,
      overrides: { orchestratorMcpServerDenylist: ['mcp-adaptor'], executionPlanStartupGraceMs: 120_000 }
    };
    const html = renderToStaticMarkup(
      <SquadEditor team={overridden} mode="edit" onClose={vi.fn()} />
    );
    // Denylist input shown with the stored server name.
    expect(html).toContain('aria-label="Team orchestrator MCP server denylist"');
    expect(html).toContain('mcp-adaptor');
    // Grace input shown in seconds (ms ÷ 1000).
    expect(html).toContain('aria-label="Team plan startup grace (seconds)"');
    expect(html).toContain('value="120"');
  });
});
