import { describe, expect, it } from 'vitest';
import { ControlError } from '../src/errors.js';
import { liveEnabled, preflightOrSkip, isSkip } from '../src/matrix.js';
import { liveTitle } from '../src/tags.js';
import { Zcc } from '../src/client.js';

const enabled = liveEnabled();

describe.skipIf(!enabled)('live combos and cleanup', () => {
  it('runs a thread then a CLI Agent in the sandbox, plus parent/child', async () => {
    const zcc = await Zcc.connect();
    try {
      const project = await zcc.projects.ensureLiveSandbox();
      const threadPre = await preflightOrSkip(zcc, { surface: 'thread', providerId: 'claude-code' });
      if (!isSkip(threadPre)) {
        const parent = await zcc.threads.spawn({
          projectId: project.id,
          prompt: 'reply with PONG and stop',
          providerId: 'claude-code'
        });
        await parent.wait({ until: 'idle', timeoutMs: 120_000, onInteraction: 'fail' });
        const child = await zcc.threads.spawn({
          projectId: project.id,
          prompt: 'reply with CHILD and stop',
          providerId: 'claude-code',
          parentThreadId: parent.id
        });
        await child.wait({ until: 'idle', timeoutMs: 120_000, onInteraction: 'fail' });
        await child.stop();
        await parent.stop();
      }
      const agentPre = await preflightOrSkip(zcc, { surface: 'cli-agent', profile: 'claude' });
      if (!isSkip(agentPre)) {
        const agent = await zcc.cliAgents.launch({
          projectId: project.id,
          prompt: 'reply with PONG and stop',
          profile: 'claude'
        });
        await agent.wait({ until: 'idle', timeoutMs: 120_000 });
        await agent.stop();
      }
    } finally {
      await zcc.close();
    }
  });

  it('cleanup removes tagged sessions', async () => {
    const zcc = await Zcc.connect();
    try {
      const result = await zcc.cleanup();
      expect(result).toBeDefined();
      const listed = await zcc.http.request<{ threads?: Array<{ title?: string }> }>('GET', '/api/v1/threads');
      const leftover = (listed.threads ?? []).filter((row) => row.title?.includes(liveTitle(zcc.runId).slice(0, 16)));
      expect(leftover).toEqual([]);
    } finally {
      await zcc.close();
    }
  });
});

describe.skipIf(!enabled)('permission fail-fast', () => {
  it('dumps instead of hanging when an interaction appears', async () => {
    const zcc = await Zcc.connect();
    try {
      const project = await zcc.projects.ensureLiveSandbox();
      const pre = await preflightOrSkip(zcc, { surface: 'thread', providerId: 'claude-code' });
      if (isSkip(pre)) return;
      const thread = await zcc.threads.spawn({
        projectId: project.id,
        prompt: 'run the bash command `ls` and wait for approval',
        providerId: 'claude-code',
        permissionMode: 'full'
      });
      await expect(thread.wait({ until: 'idle', timeoutMs: 30_000, onInteraction: 'fail' }))
        .rejects.toBeInstanceOf(ControlError);
    } finally {
      await zcc.close();
    }
  });
});

describe.skipIf(enabled)('live combo (gated)', () => {
  it('stays skipped without ZCC_LIVE_CONTROL', () => {
    expect(liveEnabled()).toBe(false);
  });
});
