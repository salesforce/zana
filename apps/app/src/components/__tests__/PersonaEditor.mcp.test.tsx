// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ save: vi.fn(), catalogue: vi.fn() }));
vi.mock('../../lib/native-capabilities.js', () => ({ nativeCapabilities: async () => ({ skills: [], commands: [], diagnostics: [] }) }));
vi.mock('../../lib/product-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/product-client.js')>();
  return {
    ...actual,
    product: {
      ...actual.product,
      harness: { ...actual.product.harness, descriptors: async () => [] },
      personas: { ...actual.product.personas, save: mocks.save },
      mcp: { ...actual.product.mcp, catalogue: () => mocks.catalogue() }
    }
  };
});

import { PersonaEditor } from '../PersonaEditor.js';

const CAT = {
  ok: true as const,
  value: {
    entries: [
      { key: 'slack', source: 'user', available: true },
      { key: 'github', source: 'user', available: false, reason: 'credentials-stripped' },
      { key: 'search', source: 'user', available: true },
      { key: 'plugin:enterprise:search', source: 'plugin', available: true },
      { key: 'plugin:gus:gus', source: 'plugin', available: true }
    ],
    notes: []
  }
};
type P = Parameters<typeof PersonaEditor>[0]['persona'];
const edit = (persona: P = { id: 'p', name: 'P', source: 'user' }) =>
  render(<PersonaEditor persona={persona} mode="edit" onClose={() => {}} />);
const view = (persona: P) => render(<PersonaEditor persona={persona} mode="view" onClose={() => {}} />);
const saved = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
  return mocks.save.mock.calls[0][0];
};
const input = () => screen.getByLabelText('Allowed MCP servers');

beforeEach(() => {
  (globalThis as any).CSS ??= { escape: (v: string) => v };
  Element.prototype.scrollIntoView ??= () => {};
  mocks.save.mockReset();
  mocks.save.mockImplementation(async (i: { name: string }) => ({ id: 'x', source: 'user', ...i }));
  mocks.catalogue.mockReset();
  mocks.catalogue.mockResolvedValue(CAT);
});
afterEach(cleanup);

describe('PersonaEditor Restrict MCP servers', () => {
  it('absent saves absent and does not fetch the catalogue', async () => {
    edit();
    expect((await saved()).mcpServers).toBeUndefined();
    expect(mocks.catalogue).not.toHaveBeenCalled();
    expect(screen.getByTestId('persona-mcp-effective').textContent).toContain('Unrestricted');
  });

  it('restricting with no entries saves [] and shows zcc-inbox as the fixed chip', async () => {
    edit();
    fireEvent.click(screen.getByLabelText('Restrict MCP servers'));
    const mcp = screen.getByTestId('persona-mcp-field');
    expect(mcp.querySelector('[data-testid="allowlist-fixed-chip"]')?.textContent).toContain('zcc-inbox');
    expect((await saved()).mcpServers).toEqual([]);
  });

  it('suggests catalogue servers with their source and saves the picked list', async () => {
    edit();
    fireEvent.click(screen.getByLabelText('Restrict MCP servers'));
    await waitFor(() => expect(screen.getByTestId('persona-mcp-effective').textContent).toContain('named'));
    fireEvent.change(input(), { target: { value: 'sl' } });
    await waitFor(() => expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['slackuser']));
    fireEvent.mouseDown(screen.getByRole('option'));
    fireEvent.change(input(), { target: { value: 'plugin:gus:gus' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect((await saved()).mcpServers).toEqual(['slack', 'plugin:gus:gus']);
  });

  it('warns on an ambiguous bare name (AC-14e) but not on a pinned one', async () => {
    edit({ id: 'p', name: 'P', source: 'user', mcpServers: ['search', 'plugin:enterprise:search'] });
    const warn = await screen.findByTestId('persona-mcp-ambiguous-warning');
    expect(warn.textContent).toContain('"search" matches 2 sources');
    expect(warn.textContent).toContain('plugin:enterprise:search');
    expect(screen.getAllByTestId('persona-mcp-ambiguous-warning')).toHaveLength(1);
  });

  it('shows a not-installed advisory that never blocks save', async () => {
    edit({ id: 'p', name: 'P', source: 'user', mcpServers: ['slack', 'jira'] });
    expect((await screen.findByTestId('persona-mcp-missing-warning')).textContent).toContain('Not installed: jira.');
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
    expect((await saved()).mcpServers).toEqual(['slack', 'jira']);
  });

  it('flags an installed-but-unavailable server', async () => {
    edit({ id: 'p', name: 'P', source: 'user', mcpServers: ['github'] });
    expect((await screen.findByTestId('persona-mcp-unavailable-warning')).textContent).toContain('credentials-stripped');
  });

  it.each([
    ['rejects', () => mocks.catalogue.mockRejectedValue(new Error('boom'))],
    ['is not ok', () => mocks.catalogue.mockResolvedValue({ ok: false, code: 'MCP_CATALOGUE_FAILED', message: 'x' })]
  ])('stays silent, still editable and saveable when the catalogue %s', async (_n, arrange) => {
    arrange();
    edit({ id: 'p', name: 'P', source: 'user', mcpServers: ['whatever'] });
    await waitFor(() => expect(screen.getByTestId('allowlist-suggestions-status').textContent).toContain('unavailable'));
    expect(screen.queryByTestId('persona-mcp-missing-warning')).toBeNull();
    fireEvent.change(input(), { target: { value: 'typed' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect((await saved()).mcpServers).toEqual(['whatever', 'typed']);
  });

  it('shows loading while the catalogue is pending and no advisory yet', async () => {
    mocks.catalogue.mockReturnValue(new Promise(() => {}));
    edit({ id: 'p', name: 'P', source: 'user', mcpServers: ['x'] });
    expect(screen.getByTestId('allowlist-suggestions-status').textContent).toContain('Loading');
    expect(screen.queryByTestId('persona-mcp-missing-warning')).toBeNull();
  });

  it('rejects glob entries inline', () => {
    edit({ id: 'p', name: 'P', source: 'user', mcpServers: [] });
    fireEvent.change(input(), { target: { value: 'sl*' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(screen.getByTestId('allowlist-error').textContent).toContain('not a valid server name');
  });

  it('warns about a legacy stored value until it is changed, and unchecking clears the field', async () => {
    edit({ id: 'p', name: 'P', source: 'user', mcpServers: ['zana-legacy'] });
    expect(screen.getByTestId('persona-mcp-legacy-warning').textContent).toContain('only');
    fireEvent.change(input(), { target: { value: 'slack' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(screen.queryByTestId('persona-mcp-legacy-warning')).toBeNull();
    fireEvent.click(screen.getByLabelText('Restrict MCP servers'));
    expect((await saved()).mcpServers).toBeUndefined();
  });

  it('notes that a non-agent harness ignores the list but keeps the control editable', async () => {
    edit({ id: 'p', name: 'P', source: 'user', baseProfile: 'shell', mcpServers: ['slack'] });
    expect(screen.getByTestId('persona-mcp-harness-note').textContent).toContain('ignored');
    expect(screen.getByTestId('persona-mcp-effective').textContent).toContain('No effect');
    fireEvent.change(input(), { target: { value: 'github' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect((await saved()).mcpServers).toEqual(['slack', 'github']);
  });

  it('effective line counts catalogue servers covered', async () => {
    edit({ id: 'p', name: 'P', source: 'user', mcpServers: ['search'] });
    await waitFor(() => expect(screen.getByTestId('persona-mcp-effective').textContent).toBe('Restricted: 2 of 5 known servers, plus zcc-inbox.'));
  });

  it('built-in detail is read-only with the override affordance and lists the MCP list', () => {
    view({ id: 'builtin:r', name: 'R', source: 'builtin', mcpServers: ['slack'] });
    expect(screen.getByTestId('persona-mcp-detail').textContent).toContain('slack');
    expect(screen.getByRole('button', { name: /Edit override/ })).toBeTruthy();
    expect(screen.queryByLabelText('Restrict MCP servers')).toBeNull();
    cleanup();
    view({ id: 'u', name: 'U', source: 'user', mcpServers: [] });
    expect(screen.getByTestId('persona-mcp-detail').textContent).toContain('No MCP servers beyond zcc-inbox');
    cleanup();
    view({ id: 'u', name: 'U', source: 'user' });
    expect(screen.queryByTestId('persona-mcp-detail')).toBeNull();
  });

  it('a restricted built-in override explains that a copy wins', () => {
    edit({ id: 'builtin:r', name: 'R', source: 'builtin', mcpServers: [] });
    expect(screen.getAllByText(/restricted by default/)).toHaveLength(1);
  });
});
