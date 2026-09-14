import { describe, expect, it } from 'vitest';
import { ControlError } from '../src/errors.js';
import { liveEnabled } from '../src/matrix.js';
import { Zcc } from '../src/client.js';

const enabled = liveEnabled();

describe.skipIf(!enabled)('live CLI Agent smoke', () => {
  it('launches, idles, and stops', async () => {
    const zcc = await Zcc.connect();
    try {
      const project = await zcc.projects.ensureLiveSandbox();
      const pre = await zcc.harness.preflight({ surface: 'cli-agent', profile: 'claude' }).catch((error: unknown) => {
        if (error instanceof ControlError && error.code === 'PREFLIGHT') return { skip: true as const, reason: error.message };
        throw error;
      });
      if ('skip' in pre && pre.skip) return;
      const agent = await zcc.cliAgents.launch({
        projectId: project.id,
        prompt: 'reply with PONG and stop',
        profile: 'claude'
      });
      await agent.wait({ until: 'idle', timeoutMs: 120_000 });
      await agent.stop();
    } finally {
      await zcc.close();
    }
  });
});

describe.skipIf(enabled)('live CLI Agent smoke (gated)', () => {
  it('does not run without ZCC_LIVE_CONTROL=1', () => {
    expect(liveEnabled()).toBe(false);
  });
});
