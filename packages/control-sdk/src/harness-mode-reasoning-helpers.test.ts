import { describe, expect, it } from 'vitest';
import { ControlError } from './errors.js';
import { assertRoleXorModel } from './cli-agents.js';
import {
  CLI_MODEL_LEVELS,
  EXECUTION_STATES,
  PLAN_PROMPT,
  THREAD_PROVIDER_BY_PROFILE,
  cliModeReasoningCases,
  isUnattendedPolicyDeny,
  threadModeReasoningCases,
  waitUntilAlive
} from '../live/harness-mode-reasoning-helpers.js';

describe('mode/reasoning case tables', () => {
  it('maps the four scenario families onto thread provider ids', () => {
    expect(THREAD_PROVIDER_BY_PROFILE).toEqual({
      claude: 'claude-code',
      cursor: 'acp-cursor',
      codex: 'codex',
      opencode: 'acp-opencode'
    });
  });

  it('covers additive thread modes and reasoning without a cartesian product', () => {
    const cases = threadModeReasoningCases();
    const names = cases.map((row) => row.name);
    expect(names).toEqual([
      'claude-code mode agent',
      'claude-code mode plan',
      'claude-code reasoning low',
      'claude-code reasoning medium',
      'claude-code reasoning high',
      'acp-cursor mode agent',
      'acp-cursor mode plan',
      'acp-cursor reasoning low',
      'acp-cursor reasoning medium',
      'acp-cursor reasoning high',
      'codex mode agent',
      'codex mode plan',
      'codex reasoning low',
      'codex reasoning medium',
      'codex reasoning high',
      'acp-opencode mode build',
      'acp-opencode mode plan',
      'acp-opencode reasoning low',
      'acp-opencode reasoning medium',
      'acp-opencode reasoning high',
      'acp-mastracode mode build',
      'acp-mastracode mode plan',
      'acp-mastracode mode fast'
    ]);
    expect(cases.some((row) => row.acpMode && row.reasoningLevel)).toBe(false);
    expect(cases.find((row) => row.name === 'claude-code mode plan')?.prompt).toBe(PLAN_PROMPT);
    expect(cases.find((row) => row.name === 'claude-code mode plan')?.acpMode).toBeUndefined();
    expect(cases.find((row) => row.name === 'acp-opencode mode build')?.acpMode).toBe('build');
    expect(cases.find((row) => row.name === 'acp-cursor mode plan')?.acpMode).toBe('plan');
    expect(cases.find((row) => row.name === 'acp-mastracode mode fast')?.acpMode).toBe('fast');
  });

  it('covers CLI execution states, OpenCode roles, and mapped model levels', () => {
    const cases = cliModeReasoningCases();
    expect(EXECUTION_STATES).toEqual(['plan', 'interactive', 'accept-edits', 'autonomous']);
    expect(CLI_MODEL_LEVELS.cursor).toEqual(['medium', 'high']);
    expect(CLI_MODEL_LEVELS.cursor).not.toContain('low');
    expect(CLI_MODEL_LEVELS.claude).toEqual(['low', 'medium', 'high']);

    for (const profile of ['claude', 'cursor', 'codex', 'opencode'] as const) {
      for (const state of EXECUTION_STATES) {
        const row = cases.find((item) => item.name === `${profile} executionState ${state}`);
        expect(row?.harnessRouting?.byAdapter[profile]).toEqual({ executionState: state });
        expect(row?.harnessRouting?.byAdapter[profile]?.roleTargetId).toBeUndefined();
      }
    }

    const build = cases.find((row) => row.name === 'opencode role build');
    expect(build?.harnessRouting?.byAdapter.opencode).toEqual({ roleTargetId: 'build' });
    expect(build?.harnessRouting?.byAdapter.opencode?.executionState).toBeUndefined();
    expect(build?.harnessRouting?.byAdapter.opencode?.modelLevel).toBeUndefined();

    const plan = cases.find((row) => row.name === 'opencode role plan');
    expect(plan?.harnessRouting?.byAdapter.opencode).toEqual({ roleTargetId: 'plan' });

    expect(cases.some((row) => row.name === 'cursor modelLevel low')).toBe(false);
    expect(cases.find((row) => row.name === 'cursor modelLevel medium')?.harnessRouting?.byAdapter.cursor).toEqual({
      modelLevel: 'medium'
    });
    expect(cases.find((row) => row.name === 'opencode modelLevel high')?.harnessRouting?.byAdapter.opencode?.roleTargetId)
      .toBeUndefined();

    expect(cases.find((row) => row.name === 'mastracode executionState interactive')?.harnessRouting?.byAdapter.mastracode)
      .toEqual({ executionState: 'interactive' });
    expect(cases.find((row) => row.name === 'mastracode executionState accept-edits')?.harnessRouting?.byAdapter.mastracode)
      .toEqual({ executionState: 'accept-edits' });
    expect(cases.some((row) => row.name === 'mastracode executionState plan')).toBe(false);
    expect(cases.some((row) => row.name === 'mastracode modelLevel medium')).toBe(false);
  });

  it('rejects OpenCode role + modelLevel the same way as role + catalog model', () => {
    expect(() => assertRoleXorModel({
      harnessRouting: {
        schemaVersion: 1,
        byAdapter: { opencode: { roleTargetId: 'build', modelLevel: 'medium' } }
      }
    })).toThrow(ControlError);
  });
});

describe('waitUntilAlive', () => {
  it('returns when a thread is starting or active', async () => {
    await expect(waitUntilAlive(async () => ({ status: 'starting' }), {
      kind: 'thread',
      sleep: async () => undefined,
      nowMs: () => 0,
      timeoutMs: 1_000
    })).resolves.toEqual({ status: 'starting' });
    await expect(waitUntilAlive(async () => ({ status: 'active' }), {
      kind: 'thread',
      sleep: async () => undefined,
      nowMs: () => 0,
      timeoutMs: 1_000
    })).resolves.toEqual({ status: 'active' });
  });

  it('fails when a thread enters error', async () => {
    await expect(waitUntilAlive(async () => ({ status: 'error' }), {
      kind: 'thread',
      sleep: async () => undefined,
      nowMs: () => 0,
      timeoutMs: 1_000
    })).rejects.toMatchObject({ code: 'UNHEALTHY' });
  });

  it('returns when a CLI agent is working', async () => {
    const row = await waitUntilAlive(async () => ({ status: 'working' }), {
      kind: 'cli-agent',
      sleep: async () => undefined,
      nowMs: () => 0,
      timeoutMs: 1_000
    });
    expect(row.status).toBe('working');
  });

  it('returns when a CLI agent reports unknown (product-server status shape)', async () => {
    await expect(waitUntilAlive(async () => ({ status: 'unknown' }), {
      kind: 'cli-agent',
      sleep: async () => undefined,
      nowMs: () => 0,
      timeoutMs: 1_000
    })).resolves.toEqual({ status: 'unknown' });
  });

  it('treats early CLI exit as a crash', async () => {
    await expect(waitUntilAlive(async () => ({ status: 'exited' }), {
      kind: 'cli-agent',
      sleep: async () => undefined,
      nowMs: () => 0,
      timeoutMs: 1_000
    })).rejects.toMatchObject({ code: 'UNHEALTHY' });
  });

  it('treats NOT_FOUND as a crash', async () => {
    await expect(waitUntilAlive(async () => {
      throw new ControlError('NOT_FOUND', 'gone');
    }, {
      kind: 'cli-agent',
      sleep: async () => undefined,
      nowMs: () => 0,
      timeoutMs: 1_000
    })).rejects.toMatchObject({ code: 'UNHEALTHY' });
  });

  it('times out when status never becomes alive', async () => {
    let now = 0;
    await expect(waitUntilAlive(async () => ({ status: '' }), {
      kind: 'cli-agent',
      sleep: async () => {
        now += 250;
      },
      nowMs: () => now,
      timeoutMs: 500
    })).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('recognizes clean unattended execution DENIED as a policy reject', () => {
    expect(isUnattendedPolicyDeny(new ControlError(
      'HTTP_ERROR',
      'DENIED: Structured execution unavailable: target disallows unattended execution'
    ))).toBe(true);
    expect(isUnattendedPolicyDeny(new ControlError(
      'HTTP_ERROR',
      'DENIED: Structured execution unavailable: no matching consent'
    ))).toBe(true);
    expect(isUnattendedPolicyDeny(new ControlError('TIMEOUT', 'nope'))).toBe(false);
  });
});
