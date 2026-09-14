import { describe, expect, it } from 'vitest';
import { ControlError } from '../src/errors.js';
import { liveEnabled, isSkip } from '../src/matrix.js';
import { Zcc } from '../src/client.js';

const enabled = liveEnabled();

describe.skipIf(!enabled)('live thread smoke', () => {
  it('spawns, idles, sends a second turn, and stops', async () => {
    const zcc = await Zcc.connect();
    try {
      const project = await zcc.projects.ensureLiveSandbox();
      const pre = await zcc.harness.preflight({ surface: 'thread', providerId: 'claude-code' }).catch((error: unknown) => {
        if (error instanceof ControlError && error.code === 'PREFLIGHT') return { skip: true as const, reason: error.message };
        throw error;
      });
      if ('skip' in pre && pre.skip) return;
      const thread = await zcc.threads.spawn({
        projectId: project.id,
        prompt: 'reply with PONG and stop',
        providerId: 'claude-code',
        permissionMode: 'accept-edits'
      });
      await thread.wait({ until: 'idle', timeoutMs: 120_000, onInteraction: 'fail' });
      await thread.assertHealthy();
      await thread.send('second turn: reply PONG2 and stop');
      await thread.wait({ until: 'idle', timeoutMs: 120_000, onInteraction: 'fail' });
      await thread.stop();
    } finally {
      await zcc.close();
    }
  });
});

describe.skipIf(enabled)('live thread smoke (gated)', () => {
  it('does not run without ZCC_LIVE_CONTROL=1', () => {
    expect(liveEnabled()).toBe(false);
    expect(isSkip({ skip: true, reason: 'x' })).toBe(true);
  });
});
