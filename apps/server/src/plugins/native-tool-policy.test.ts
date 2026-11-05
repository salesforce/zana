import { describe, expect, it, vi } from 'vitest';
import type { PluginToolPolicyDecision, PluginToolPolicyRequest } from '@zana-ai/zcc-plugin-sdk';
import { NATIVE_ALLOW_TTL_MS, consumeNativeAllow, decideMainOwnedToolPolicy, resetNativeAllowsForTest, toolPolicyProviderId } from './native-tool-policy.js';

const call = {
  invocationId: 'a'.repeat(64),
  sessionId: 'session-1',
  projectId: 'project-1',
  profile: 'codex',
  toolName: 'Bash',
  input: { command: 'pwd' }
};

function plugins(decision: PluginToolPolicyDecision | Error) {
  const decideToolPolicy = vi.fn(async (_request: PluginToolPolicyRequest) => {
    if (decision instanceof Error) throw decision;
    return decision;
  });
  return { decideToolPolicy };
}

describe('decideMainOwnedToolPolicy', () => {
  it('denies without asking anyone when no plugin service is running', async () => {
    await expect(decideMainOwnedToolPolicy(undefined, call)).resolves.toEqual({
      action: 'deny', reason: 'plugin service is unavailable'
    });
  });

  it('passes the main-asserted identity through and redacts the input before a plugin sees it', async () => {
    const service = plugins({ action: 'allow' });
    await expect(decideMainOwnedToolPolicy(service, {
      ...call,
      input: { command: 'deploy', nested: { password: 'hunter2', apiKey: 'k', keep: 'yes' }, blob: 'x'.repeat(16_385) }
    })).resolves.toEqual({ action: 'allow' });
    expect(service.decideToolPolicy).toHaveBeenCalledWith({
      invocationId: call.invocationId,
      threadId: 'session-1',
      sessionId: 'session-1',
      surface: 'pty',
      projectId: 'project-1',
      providerId: 'codex',
      toolName: 'Bash',
      input: { command: 'deploy', nested: { password: '[REDACTED]', apiKey: '[REDACTED]', keep: 'yes' }, blob: '[REDACTED]' }
    });
  });

  it('reports the bound thread, not the PTY id, when main has a thread binding', async () => {
    const service = plugins({ action: 'allow' });
    await decideMainOwnedToolPolicy(service, { ...call, threadId: 'thread-9' });
    expect(service.decideToolPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'thread-9', sessionId: 'session-1', surface: 'pty' })
    );
  });

  it('labels a thread-only request as a Modern call without a session id', async () => {
    const service = plugins({ action: 'allow' });
    const { sessionId: _pty, ...thread } = call;
    await decideMainOwnedToolPolicy(service, { ...thread, threadId: 'thread-3' });
    const sent = service.decideToolPolicy.mock.calls[0]![0];
    expect(sent).toMatchObject({ threadId: 'thread-3', surface: 'modern' });
    expect(sent).not.toHaveProperty('sessionId');
  });

  it.each([
    ['', 'denied by plugin tool policy'],
    ['  ', 'denied by plugin tool policy'],
    ['x\ud83d', 'x\ufffd'],
    ['r'.repeat(2000), 'r'.repeat(1024)],
    ['blocked by policy', 'blocked by policy']
  ])('normalises the plugin deny reason %j', async (reason, expected) => {
    await expect(decideMainOwnedToolPolicy(plugins({ action: 'deny', reason }), call)).resolves.toEqual({
      action: 'deny', reason: expected
    });
  });

  it('lets a plugin service failure propagate so the caller fails closed', async () => {
    await expect(decideMainOwnedToolPolicy(plugins(new Error('policy store offline')), call)).rejects.toThrow('policy store offline');
  });

  it.each([undefined, null, {}, { action: 'unknown' }, { action: 'allow', reason: 'ignored' }])('denies malformed decision %j', async decision => {
    await expect(decideMainOwnedToolPolicy(plugins(decision as never), call)).resolves.toEqual({
      action: 'deny', reason: 'plugin tool policy returned an invalid decision'
    });
  });

  it('uses the resolved Modern provider identity without interpreting a launch profile', async () => {
    const service = plugins({ action: 'allow' });
    await decideMainOwnedToolPolicy(service, call, 'provider-exact');
    expect(service.decideToolPolicy).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'provider-exact' }));
  });
});

describe('toolPolicyProviderId', () => {
  // One profile literal per line: the launch-provider guard flags a line naming two Claude variants.
  it.each([
    ['claude', 'claude-code'],
    ['claude-resume', 'claude-code'],
    ['claude-yolo', 'claude-code'],
    ['codex', 'codex'],
    ['codex-resume', 'codex'],
    ['codex-yolo', 'codex'],
    ['cursor-yolo', 'acp-cursor'],
    ['shell', 'shell'],
    ['unknown-x', 'unknown-x']
  ])('maps %s to %s', (profile, providerId) => {
    expect(toolPolicyProviderId(profile)).toBe(providerId);
  });
});

describe('native allow record', () => {
  it('expires, is one-shot, and is bounded', async () => {
    resetNativeAllowsForTest();
    await decideMainOwnedToolPolicy(plugins({ action: 'allow' }), call);
    expect(consumeNativeAllow('session-1', 'Bash', call.input, Date.now() + NATIVE_ALLOW_TTL_MS + 1)).toBe(false);
    await decideMainOwnedToolPolicy(plugins({ action: 'allow' }), call);
    expect(consumeNativeAllow('session-1', 'Bash', call.input)).toBe(true);
    expect(consumeNativeAllow('session-1', 'Bash', call.input)).toBe(false);
    for (let i = 0; i < 300; i++) await decideMainOwnedToolPolicy(plugins({ action: 'allow' }), { ...call, input: { i } });
    expect(consumeNativeAllow('session-1', 'Bash', { i: 0 })).toBe(false);
    expect(consumeNativeAllow('session-1', 'Bash', { i: 299 })).toBe(true);
  });
});
