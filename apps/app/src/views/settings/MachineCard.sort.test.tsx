/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderCliStatus } from '@zana-ai/zcc-contracts/host-rpc';
import { MachineCliInventory } from './MachineCard.js';
import type { MachineProviderCliRow } from './machine-provider-clis.js';

vi.mock('../../lib/product-client.js', () => ({ product: { hosts: {} } }));
vi.mock('@/store', () => ({
  useData: () => [],
  useUi: { getState: () => ({}) }
}));

function cli(displayName: string, overrides: Partial<ProviderCliStatus> = {}): ProviderCliStatus {
  return {
    displayName,
    installed: true,
    currentVersion: '1.0.0',
    latestVersion: '1.0.0',
    needsUpdate: false,
    installAction: null,
    ...overrides
  } as ProviderCliStatus;
}

afterEach(cleanup);

describe('MachineCliInventory ordering', () => {
  it('renders rows alphabetically by display name and keeps provider-keyed actions', () => {
    const onInstall = vi.fn();
    const rows: MachineProviderCliRow[] = Object.freeze([
      { provider: 'codex', status: cli('Codex') },
      { provider: 'pi', status: cli('PI', { installAction: { kind: 'install', label: 'Install PI' } as never }) },
      { provider: 'claudeCode', status: cli('Claude Code') },
      { provider: 'opencode', status: cli('OpenCode') },
      { provider: 'cursor', status: cli('Codex') }
    ]) as unknown as MachineProviderCliRow[];
    render(<MachineCliInventory hostId="h1" rows={rows} busyKey={null} onInstall={onInstall} />);
    const names = screen.getAllByRole('listitem').map((li) => li.querySelector('strong')?.textContent);
    expect(names).toEqual(['Claude Code', 'Codex', 'Codex', 'OpenCode', 'PI']);
    expect(rows.map((r) => r.provider)).toEqual(['codex', 'pi', 'claudeCode', 'opencode', 'cursor']);
    fireEvent.click(screen.getByRole('button', { name: 'Install PI' }));
    expect(onInstall).toHaveBeenCalledWith('pi', 'install');
  });

  it('keeps the empty state', () => {
    render(<MachineCliInventory hostId="h1" rows={[]} busyKey={null} onInstall={vi.fn()} />);
    expect(screen.getByText('Checking harness CLIs…')).toBeTruthy();
  });
});
