import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Host } from '@zana-ai/zcc-domain/thread-runtime';
import { RemoteMachineDefaultsList } from './RemoteMachineDefaultsList.js';

const hostsState: { current: Host[] } = { current: [] };

vi.mock('../../hooks/useHosts.js', () => ({
  useHosts: () => hostsState.current
}));

function host(overrides: Partial<Host> = {}): Host {
  return {
    id: 'h1',
    name: 'limited-pony',
    type: 'persistent',
    status: 'connected',
    maxPermissionMode: 'full',
    lastSeenAt: 1,
    lastRejectedProtocolVersion: null,
    isPrimary: false,
    canRepairViaSsh: true,
    sshHost: 'limited-pony',
    defaultWorkspacePath: '/opt/workspace/core',
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  };
}

describe('RemoteMachineDefaultsList', () => {
  it('lists enrolled machine defaults and links to Machines', () => {
    hostsState.current = [
      host({ isPrimary: true, name: 'MacBook', defaultWorkspacePath: '/should-hide' }),
      host()
    ];
    const html = renderToStaticMarkup(<RemoteMachineDefaultsList />);
    expect(html).toContain('Remote defaults');
    expect(html).toContain('limited-pony');
    expect(html).toContain('/opt/workspace/core');
    expect(html).not.toContain('MacBook');
    expect(html).not.toContain('/should-hide');
    expect(html).toContain('data-testid="remote-machine-defaults-link"');
    expect(html).toContain('/settings/machines');
  });

  it('points unpaired setups at Machines', () => {
    hostsState.current = [host({ isPrimary: true, name: 'MacBook' })];
    const html = renderToStaticMarkup(<RemoteMachineDefaultsList />);
    expect(html).toContain('data-testid="remote-machine-defaults-empty"');
    expect(html).toContain('Add a machine');
  });
});
