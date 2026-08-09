/**
 * Unit tests for the C4 `TicketDetailModal` launch-args builder. This repo has
 * no DOM test harness (no jsdom / @testing-library; see the C2 ticketColumns
 * test note), so — mirroring the repo convention — we test the load-bearing
 * PURE logic the modal renders over rather than mounting React. The full
 * Start / fetch / nav flow is covered end-to-end by `launchTicketSession.test.ts`
 * (the wrapper the modal calls) and exercised manually (D4).
 *
 * `buildLaunchArgs` is the security-relevant seam: it emits exactly the
 * attacker-influenceable profile flags (`--append-system-prompt`,
 * `--allowedTools`, `--disallowedTools`, `--permission-mode`, `--model`) that
 * the MAIN denylist (A6) is the authoritative backstop for, so its shape is
 * worth pinning.
 */
import { describe, it, expect } from 'vitest';
import type { ZanaProfileDetail, ZanaTicketDetail } from '@shared/zana-types';
import { sanitizeExtraArgs } from '@shared/launch-sanitize';
import { buildLaunchArgs } from '../TicketDetailModal';

function mkProfile(over: Partial<ZanaProfileDetail> = {}): ZanaProfileDetail {
  return {
    id: 'architect',
    displayName: 'Architect',
    origin: 'workspace',
    ...over
  } as ZanaProfileDetail;
}

function mkTicket(over: Partial<ZanaTicketDetail> = {}): ZanaTicketDetail {
  return {
    id: 'abcdef1234',
    title: 'Do the thing',
    status: 'backlog',
    labels: [],
    blockedBy: [],
    audit: [],
    ...over
  } as ZanaTicketDetail;
}

describe('buildLaunchArgs', () => {
  it('maps profile fields onto the matching claude CLI flags, prompt last', () => {
    const args = buildLaunchArgs(
      mkProfile({
        model: 'opus',
        systemPrompt: 'be terse',
        allowedTools: ['Read', 'Edit'],
        disallowedTools: ['Bash'],
        permissionMode: 'acceptEdits'
      }),
      mkTicket({ description: 'context here' })
    );
    expect(args.slice(0, args.length - 1)).toEqual([
      '--model',
      'opus',
      '--append-system-prompt',
      'be terse',
      '--allowedTools',
      'Read,Edit',
      '--disallowedTools',
      'Bash',
      '--permission-mode',
      'acceptEdits'
    ]);
    // The final positional is the seeded prompt.
    const prompt = args[args.length - 1];
    expect(prompt).toContain('Work Zana ticket abcdef12');
    expect(prompt).toContain('Do the thing');
    expect(prompt).toContain('context here');
    expect(prompt).toContain('"Architect" profile');
  });

  it('omits flags for absent profile fields (only the prompt for a bare profile)', () => {
    const args = buildLaunchArgs(mkProfile(), mkTicket());
    expect(args).toHaveLength(1);
    expect(args[0]).toContain('Work Zana ticket');
  });

  it('renderer sanitize is advisory — it strips the trusted profile flags, leaving the prompt', () => {
    // This documents WHY the renderer pass is advisory: the profile flags are
    // re-applied as the trusted persona layer in MAIN (A6 does NOT sanitize the
    // trusted layer); the renderer denylist would strip them, so launch
    // correctness depends on MAIN re-applying them, not on these surviving here.
    const args = buildLaunchArgs(
      mkProfile({ systemPrompt: 'x', allowedTools: ['Read'], permissionMode: 'acceptEdits' }),
      mkTicket()
    );
    const { args: safe, removed } = sanitizeExtraArgs(args);
    expect(removed).toEqual(
      expect.arrayContaining(['--append-system-prompt', '--allowedTools', '--permission-mode'])
    );
    // The seeded prompt (a positional, not a flag) always survives.
    expect(safe.some((a) => a.includes('Work Zana ticket'))).toBe(true);
  });
});
