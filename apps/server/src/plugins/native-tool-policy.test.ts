import { describe, expect, it, vi } from 'vitest';
import type { PluginToolPolicyDecision, PluginToolPolicyRequest } from '@zana-ai/zcc-plugin-sdk';
import { decideMainOwnedToolPolicy, toolPolicyProviderId } from './native-tool-policy.js';

const call = {
  invocationId: 'a'.repeat(64),
  threadId: 'session-1',
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
      projectId: 'project-1',
      providerId: 'codex',
      toolName: 'Bash',
      input: { command: 'deploy', nested: { password: '[REDACTED]', apiKey: '[REDACTED]', keep: 'yes' }, blob: '[REDACTED]' }
    });
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
