import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveProviderFamily } from './thread-create.js';

describe('resolveProviderFamily', () => {
  it('maps a concrete profile onto its harness family', () => {
    expect(resolveProviderFamily('claude')).toBe('claude');
    expect(resolveProviderFamily('claude-yolo')).toBe('claude');
    expect(resolveProviderFamily('codex-resume')).toBe('codex');
    expect(resolveProviderFamily('shell')).toBe('shell');
  });

  it('rejects unknown ids', () => {
    expect(resolveProviderFamily('not-a-harness')).toBeNull();
  });
});

describe('createThreadFromRequest host spawn', () => {
  it('allows empty prompts, remote unmanaged spawn, and launch fields', () => {
    const source = readFileSync(new URL('./thread-create.ts', import.meta.url), 'utf8');
    expect(source).toContain("remote projects can only use this checkout");
    expect(source).toContain('reconnectTmuxId: args.input.reconnectTmuxId');
    expect(source).toContain('autonomous: args.input.autonomous');
    expect(source).toContain('cohort: args.input.cohort');
    expect(source).not.toContain('requireLocalProject');
    expect(source).toContain("parseProfile(input.providerId) === 'shell' ? 'Shell' : 'Agent'");
    expect(source).toContain('requestedThreadId(input)');
    expect(source).toContain('isRemoteToolProxyActive(project, input.hostId)');
    expect(source).toContain('remoteWorkspacePath(project, remoteToolProxy)');
    expect(source).toContain('resolveSpawnChoiceForHost');
    expect(source).toContain('resolvePersonalTargetPathOnHost');
    expect(source).not.toContain('readRemoteToolProxySetting');
  });
});
