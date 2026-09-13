import { describe, expect, it } from 'vitest';
import { ControlError } from '../src/errors.js';
import { liveEnabled, preflightOrSkip, isSkip } from '../src/matrix.js';
import { Zcc } from '../src/client.js';

const enabled = liveEnabled();

const PERMISSIONS = ['accept-edits', 'auto', 'full'] as const;
const PROVIDERS = [
  { providerId: 'claude-code' },
  { providerId: 'acp-opencode', acpMode: 'build' }
] as const;

describe.skipIf(!enabled)('live thread composer matrix', () => {
  it('covers permissionMode × provider with preflight skips', async () => {
    const zcc = await Zcc.connect();
    try {
      const project = await zcc.projects.ensureLiveSandbox();
      for (const provider of PROVIDERS) {
        const pre = await preflightOrSkip(zcc, { surface: 'thread', providerId: provider.providerId });
        if (isSkip(pre)) continue;
        for (const permissionMode of PERMISSIONS) {
          const thread = await zcc.threads.spawn({
            projectId: project.id,
            prompt: 'reply with PONG and stop',
            providerId: provider.providerId,
            acpMode: 'acpMode' in provider ? provider.acpMode : undefined,
            permissionMode
          });
          await thread.wait({ until: 'idle', timeoutMs: 120_000, onInteraction: 'fail' });
          await thread.assertHealthy();
          await thread.stop();
        }
      }
    } finally {
      await zcc.close();
    }
  });
});

describe.skipIf(enabled)('live thread matrix (gated)', () => {
  it('stays skipped without ZCC_LIVE_CONTROL', () => {
    expect(liveEnabled()).toBe(false);
    expect(ControlError).toBeDefined();
  });
});
