import { describe, expect, it } from 'vitest';
import { ControlError } from '../src/errors.js';
import { liveEnabled } from '../src/matrix.js';
import type { CliAgentHandle } from '../src/cli-agents.js';
import { withLiveAgent } from './cli-agent-helpers.js';
import {
  ALIVE_TIMEOUT_MS,
  CRASH_PROMPT,
  cliModeReasoningCases,
  isUnattendedPolicyDeny,
  threadModeReasoningCases,
  waitUntilAlive,
  withLiveThread
} from './harness-mode-reasoning-helpers.js';

const enabled = liveEnabled();
const CASE_TIMEOUT_MS = 60_000;

describe.skipIf(!enabled)('live harness mode/reasoning crash checks', () => {
  it.each(threadModeReasoningCases())('thread $name does not crash', async (row) => {
    await withLiveThread(row.providerId, async ({ zcc, project }) => {
      const thread = await zcc.threads.spawn({
        projectId: project.id,
        prompt: row.prompt,
        providerId: row.providerId,
        acpMode: row.acpMode,
        reasoningLevel: row.reasoningLevel
      });
      try {
        const alive = await waitUntilAlive(() => thread.refresh(), {
          kind: 'thread',
          sleep: zcc.http.sleep,
          nowMs: zcc.http.nowMs,
          timeoutMs: ALIVE_TIMEOUT_MS
        });
        expect(alive.status).not.toBe('error');
      } finally {
        await thread.stop().catch(() => undefined);
      }
    });
  }, CASE_TIMEOUT_MS);

  it.each(cliModeReasoningCases())('cli-agent $name does not crash', async (row) => {
    await withLiveAgent(row.profile, async ({ zcc, project }) => {
      let agent: CliAgentHandle | undefined;
      try {
        agent = await zcc.cliAgents.launch({
          projectId: project.id,
          profile: row.profile,
          prompt: CRASH_PROMPT,
          harnessRouting: row.harnessRouting
        });
      } catch (error) {
        if (isUnattendedPolicyDeny(error)) return;
        throw error;
      }
      if (!agent) return;
      try {
        const alive = await waitUntilAlive(() => agent.refresh(), {
          kind: 'cli-agent',
          sleep: zcc.http.sleep,
          nowMs: zcc.http.nowMs,
          timeoutMs: ALIVE_TIMEOUT_MS
        });
        expect(alive.status).not.toBe('exited');
        expect(alive.status).not.toBe('error');
      } finally {
        await agent.stop().catch(() => undefined);
      }
    });
  }, CASE_TIMEOUT_MS);
});

describe.skipIf(enabled)('live harness mode/reasoning (gated)', () => {
  it('stays skipped without ZCC_LIVE_CONTROL', () => {
    expect(liveEnabled()).toBe(false);
    expect(ControlError).toBeDefined();
    expect(threadModeReasoningCases().length).toBeGreaterThan(0);
    expect(cliModeReasoningCases().length).toBeGreaterThan(0);
  });
});
