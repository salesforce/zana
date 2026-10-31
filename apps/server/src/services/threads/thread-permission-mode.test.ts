import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { threadPermissionMode } from './thread-permission-mode.js';
import { readLastThreadExecution } from './thread-last-execution.js';
import { getHost } from '@zana-ai/zcc-db';
import { registerThreadProvider } from './thread-provider-catalog.js';

vi.mock('./thread-last-execution.js', () => ({ readLastThreadExecution: vi.fn() }));
vi.mock('@zana-ai/zcc-db', () => ({ getHost: vi.fn() }));
const ctx = { db: {} } as never;
const thread = { id: 'one', hostId: 'host', providerId: 'codex' };
let provider: ReturnType<typeof registerThreadProvider>;
beforeEach(() => {
  provider = registerThreadProvider('permission-fallback-test', {
    id: 'full-only-test',
    displayName: 'Full only test',
    capabilities: { supportsServiceTier: false, fork: 'none', permissionModes: ['full'] }
  });
  vi.mocked(getHost).mockReturnValue({ maxPermissionMode: 'full' } as never);
  vi.mocked(readLastThreadExecution).mockReturnValue({ permissionMode: null } as never);
});
afterEach(() => provider.unregister());

describe('threadPermissionMode', () => {
  it.each(['accept-edits', 'auto', 'full'] as const)('preserves saved %s on follow-up and resume', (mode) => {
    vi.mocked(readLastThreadExecution).mockReturnValue({ permissionMode: mode } as never);
    expect(threadPermissionMode(ctx, thread)).toBe(mode);
  });

  it('honors an explicit change over saved Full', () => {
    vi.mocked(readLastThreadExecution).mockReturnValue({ permissionMode: 'full' } as never);
    expect(threadPermissionMode(ctx, thread, 'accept-edits')).toBe('accept-edits');
  });

  it('falls back to the launch profile for old threads', () => {
    expect(threadPermissionMode(ctx, thread)).toBe('accept-edits');
    expect(threadPermissionMode(ctx, { ...thread, providerId: 'claude-yolo' })).toBe('full');
  });

  it('uses provider capabilities only when neither explicit nor saved permissions exist', () => {
    const fullOnly = { ...thread, providerId: 'full-only-test' };
    expect(threadPermissionMode(ctx, fullOnly)).toBe('full');
    expect(threadPermissionMode(ctx, fullOnly, 'accept-edits')).toBe('accept-edits');
    vi.mocked(readLastThreadExecution).mockReturnValue({ permissionMode: 'auto' } as never);
    expect(threadPermissionMode(ctx, fullOnly)).toBe('auto');
  });

  it('keeps the host ceiling when the provider default requires Full', () => {
    vi.mocked(getHost).mockReturnValue({ maxPermissionMode: 'auto' } as never);
    expect(threadPermissionMode(ctx, { ...thread, providerId: 'full-only-test' })).toBe('auto');
  });

  it('clamps both saved and explicit Full to the current host ceiling', () => {
    vi.mocked(getHost).mockReturnValue({ maxPermissionMode: 'accept-edits' } as never);
    vi.mocked(readLastThreadExecution).mockReturnValue({ permissionMode: 'full' } as never);
    expect(threadPermissionMode(ctx, thread)).toBe('accept-edits');
    expect(threadPermissionMode(ctx, thread, 'full')).toBe('accept-edits');
  });
});
