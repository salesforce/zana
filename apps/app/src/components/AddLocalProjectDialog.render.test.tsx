// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Host } from '@zana-ai/zcc-domain/thread-runtime';
import { AddLocalProjectDialog } from './AddLocalProjectDialog.js';

const mocks = vi.hoisted(() => ({ hosts: [] as Host[] }));
vi.mock('../hooks/useHosts.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/useHosts.js')>()),
  useHosts: () => mocks.hosts
}));
vi.mock('../lib/product-client.js', () => ({ product: { hosts: { directory: vi.fn() } } }));

afterEach(() => { cleanup(); mocks.hosts = []; });

function host(homeDir: string | null): Host {
  return {
    id: 'local', name: 'This machine', type: 'persistent', status: 'connected', maxPermissionMode: 'full',
    lastSeenAt: null, lastRejectedProtocolVersion: null, isPrimary: true, canRepairViaSsh: false,
    homeDir, createdAt: 0, updatedAt: 0
  } as Host;
}

function placeholder(): string {
  render(<AddLocalProjectDialog onClose={vi.fn()} onBrowse={vi.fn()} onSubmit={vi.fn()} />);
  return (screen.getByRole('textbox') as HTMLInputElement).placeholder;
}

describe('AddLocalProjectDialog folder-path placeholder', () => {
  it("uses a Windows path when this machine's home dir is on a drive", () => {
    mocks.hosts = [host('C:\\Users\\me')];
    expect(placeholder()).toBe('C:\\path\\to\\project');
  });

  it('keeps a POSIX path for a POSIX home dir', () => {
    mocks.hosts = [host('/Users/me')];
    expect(placeholder()).toBe('/path/to/project');
  });
});
