import { describe, it, expect, vi } from 'vitest';
import { PermissionBroker, grantFromManifest } from '../permission-broker.js';
import { ReviewerBroker } from '../reviewer-broker.js';

// A grant that allows exec:git + fs:read under /tmp/proj, net api.github.com.
function grant() {
  return grantFromManifest(
    ['exec', 'fs:read', 'net', 'fs:write'],
    { execAllowlist: ['git'], fsRoots: ['/tmp/proj'], egressAllowlist: ['api.github.com'] },
    '/tmp/proj'
  );
}
function base() {
  return new PermissionBroker({ builtinIds: new Set(['slack']), grants: () => grant() });
}

describe('ReviewerBroker decorator', () => {
  it('ask mode is pure passthrough (never consults)', () => {
    const peek = vi.fn(() => 'approve' as const);
    const rb = new ReviewerBroker(base(), () => 'ask', { peek } as never);
    // A request the base already allows still allows; one it denies still denies.
    expect(rb.can('gus', 'exec', { kind: 'exec', bin: 'nope' })).toBe(false);
    expect(peek).not.toHaveBeenCalled();
  });

  it('never upgrades a deterministic DENY, even with a cached approve', () => {
    const rb = new ReviewerBroker(base(), () => 'approveForMe',
      { peek: () => 'approve' } as never);
    // exec basename guard: a path is rejected by decide() BEFORE the reviewer,
    // and it's scope-ineligible so the reviewer cannot revive it.
    expect(rb.can('gus', 'exec', { kind: 'exec', bin: '/bin/rm' })).toBe(false);
    // fs:write to an OUT-OF-ROOT path is a deterministic deny; fs:write is also
    // not in the eligible set, so the reviewer never revives it.
    expect(rb.can('gus', 'fs:write', { kind: 'fs', path: '/etc/shadow' })).toBe(false);
    // A valid-basename undeclared bin IS eligible; with a cached approve the
    // reviewer legitimately downgrades that grant-based deny to allow.
    expect(rb.can('gus', 'exec', { kind: 'exec', bin: 'curl' })).toBe(true);
  });

  it('ineligible permissions (fs:write/mcp/llm) never consult', () => {
    const peek = vi.fn(() => 'approve' as const);
    const rb = new ReviewerBroker(base(), () => 'approveForMe', { peek } as never);
    rb.can('gus', 'fs:write', { kind: 'fs', path: '/tmp/proj/x' });
    expect(peek).not.toHaveBeenCalled();
  });

  it('approveForMe + eligible + base-would-ask + cached approve → allow', () => {
    // Make base "ask": a bin NOT in the allowlist but a valid basename → decide()=false,
    // eligible (exec, valid basename). Reviewer approves.
    const rb = new ReviewerBroker(base(), () => 'approveForMe', { peek: () => 'approve' } as never);
    expect(rb.can('gus', 'exec', { kind: 'exec', bin: 'ls' })).toBe(true);
  });

  it('approveForMe + eligible + cache miss (peek=ask) → false (fail closed)', () => {
    const rb = new ReviewerBroker(base(), () => 'approveForMe', { peek: () => 'ask' } as never);
    expect(rb.can('gus', 'exec', { kind: 'exec', bin: 'ls' })).toBe(false);
  });
});
