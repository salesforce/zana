import { describe, expect, it } from 'vitest';
import { ControlError } from '../src/errors.js';
import { liveEnabled, preflightOrSkip, isSkip } from '../src/matrix.js';
import { Zcc } from '../src/client.js';

const enabled = liveEnabled();

/** Base CLI Agent profiles (not resume/yolo variants). */
const PROFILES = ['claude', 'cursor', 'codex', 'pi', 'opencode', 'grok', 'mastracode'] as const;

describe.skipIf(!enabled)('live CLI Agent harness matrix', () => {
  it.each(PROFILES)('launches %s to idle when preflight passes', async (profile) => {
    const zcc = await Zcc.connect();
    try {
      const project = await zcc.projects.ensureLiveSandbox();
      const pre = await preflightOrSkip(zcc, { surface: 'cli-agent', profile });
      if (isSkip(pre)) return;
      const agent = await zcc.cliAgents.launch({
        projectId: project.id,
        prompt: 'Reply with exactly PONG and then stop. Do not use tools. Do not ask questions.',
        profile,
        harnessRouting: profile === 'opencode'
          ? { schemaVersion: 1, byAdapter: { opencode: { roleTargetId: 'build' } } }
          : undefined
      });
      expect(agent.id).toBeTruthy();
      const working = await agent.wait({ until: 'working', timeoutMs: 30_000 }).catch(() => agent.snapshot());
      expect(['working', 'idle', 'done', 'exited']).toContain(working.status);
      await agent.wait({ until: 'idle', timeoutMs: 120_000 });
      await agent.stop();
    } finally {
      await zcc.close();
    }
  }, 180_000);

  it('rejects role + model in the client before launch', async () => {
    const zcc = await Zcc.connect();
    try {
      const project = await zcc.projects.ensureLiveSandbox();
      await expect(zcc.cliAgents.launch({
        projectId: project.id,
        prompt: 'nope',
        profile: 'opencode',
        harnessRouting: {
          schemaVersion: 1,
          byAdapter: { opencode: { roleTargetId: 'build', modelTargetId: 'gpt' } }
        }
      })).rejects.toMatchObject({ code: 'ROLE_XOR_MODEL' });
    } finally {
      await zcc.close();
    }
  });
});

describe.skipIf(enabled)('live CLI Agent matrix (gated)', () => {
  it('stays skipped without ZCC_LIVE_CONTROL', () => {
    expect(liveEnabled()).toBe(false);
    expect(ControlError).toBeDefined();
  });
});
