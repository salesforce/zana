/** @vitest-environment happy-dom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Team } from '@zana-ai/zcc-domain/product';

const catalogue = vi.hoisted(() => vi.fn());
vi.mock('../../lib/native-capabilities.js', () => ({ nativeCapabilities: vi.fn().mockResolvedValue({ skills: [], commands: [], diagnostics: [] }) }));
vi.mock('../../lib/product-client.js', () => ({
  product: { teams: { save: vi.fn(), delete: vi.fn() }, mcp: { catalogue: (...a: unknown[]) => catalogue(...a) } }
}));
vi.mock('../ImprovePromptButton.js', () => ({ ImprovePromptButton: () => null }));
vi.mock('../../store.js', () => {
  const state = {
    personas: [
      { id: 'orch', name: 'Lead', mcpServers: ['github'] },
      { id: 'w1', name: 'Alpha', mcpServers: ['github', 'ghost'] },
      { id: 'w2', name: 'Beta', mcpServers: [] },
      { id: 'free', name: 'Free' }
    ],
    projects: [], pushToast: vi.fn()
  };
  return {
    usePersonas: (sel: (s: unknown) => unknown) => sel(state),
    useData: (sel: (s: unknown) => unknown) => sel(state),
    useUi: (sel: (s: unknown) => unknown) => sel(state)
  };
});

import { SquadEditor } from '../SquadEditor.js';

const mk = (ids: string[], orchestratorPersonaId?: string): Team => ({
  id: 'user:s', name: 'S', source: 'user', orchestratorPersonaId,
  slots: ids.map((personaId) => ({ personaId, quantity: 1 }))
});
const okCatalogue = { ok: true, value: { entries: [{ key: 'github', source: 'user', available: true }, { key: 'plugin:p:docs', source: 'plugin', available: false, reason: 'not-carried' }], notes: [] } };
afterEach(() => { cleanup(); catalogue.mockReset(); });

describe('SquadEditor MCP allowlist state', () => {
  it('shows the effective result per member incl. the always-allowed server', async () => {
    catalogue.mockResolvedValue(okCatalogue);
    render(<SquadEditor team={mk(['orch', 'w1', 'w2'], 'orch')} mode="edit" onClose={vi.fn()} />);
    expect(screen.getByTestId('team-mcp-row-orch').textContent).toBe('Lead (orchestrator): zcc-inbox, github');
    expect(screen.getByTestId('team-mcp-row-w1').textContent).toContain('Alpha: zcc-inbox, github, ghost');
    expect(screen.getByTestId('team-mcp-row-w2').textContent).toContain('Beta: zcc-inbox (always-allowed only)');
    await vi.waitFor(() => expect(catalogue).toHaveBeenCalled());
  });

  it('advises for allowlisted-but-missing servers; unavailable entries count as missing', async () => {
    catalogue.mockResolvedValue(okCatalogue);
    render(<SquadEditor team={mk(['w1'], 'free')} mode="edit" onClose={vi.fn()} />);
    const warn = await screen.findByTestId('team-mcp-missing-warning');
    expect(warn.textContent).toContain('Alpha (ghost)');
    expect(warn.textContent).not.toContain('github');
    expect((screen.getByRole('button', { name: /Save/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it.each([
    ['catalogue rejects', () => catalogue.mockRejectedValue(new Error('x'))],
    ['catalogue reports not ok', () => catalogue.mockResolvedValue({ ok: false, code: 'MCP_CATALOGUE_FAILED', message: 'x' })]
  ])('stays silent about missing servers when %s', async (_n, arrange) => {
    arrange();
    render(<SquadEditor team={mk(['w1'], 'free')} mode="edit" onClose={vi.fn()} />);
    await vi.waitFor(() => expect(catalogue).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('team-mcp-missing-warning')).toBeNull();
    expect(screen.getByTestId('team-mcp-row-w1')).toBeTruthy();
  });

  it('shows the hard-fail indication when every worker is restricted, listing reachable servers', () => {
    catalogue.mockResolvedValue(okCatalogue);
    render(<SquadEditor team={mk(['orch', 'w1', 'w2'], 'orch')} mode="edit" onClose={vi.fn()} />);
    const hard = screen.getByTestId('team-mcp-requires-hardfail');
    expect(hard.getAttribute('role')).toBe('alert');
    expect(hard.textContent).toContain('Launch fails for work that Requires');
    expect(hard.textContent).toContain('zcc-inbox, github, ghost');
  });

  it('omits the hard-fail indication when some worker is unrestricted', () => {
    catalogue.mockResolvedValue(okCatalogue);
    render(<SquadEditor team={mk(['orch', 'w1', 'free'], 'orch')} mode="edit" onClose={vi.fn()} />);
    expect(screen.queryByTestId('team-mcp-requires-hardfail')).toBeNull();
  });

  it('states that skills and MCP restrictions are independent controls', () => {
    catalogue.mockResolvedValue(okCatalogue);
    render(<SquadEditor team={mk(['w2'], 'free')} mode="edit" onClose={vi.fn()} />);
    expect(screen.getByTestId('team-mcp-independent-note').textContent).toMatch(/independent controls.*decides the server set/);
  });

  it('renders nothing and skips the catalogue when no member is MCP-restricted', async () => {
    render(<SquadEditor team={mk(['free'], 'free')} mode="edit" onClose={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('team-mcp-summary')).toBeNull();
    expect(catalogue).not.toHaveBeenCalled();
  });

  it('does not fetch the catalogue when members only restrict to none', async () => {
    render(<SquadEditor team={mk(['w2'], 'free')} mode="edit" onClose={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(catalogue).not.toHaveBeenCalled();
  });
});
