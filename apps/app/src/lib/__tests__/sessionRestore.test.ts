import { describe, it, expect } from 'vitest';
import type { Project, TerminalSession } from '@zana-ai/zcc-domain/product';
import {
  snapshotTabs,
  shouldResumeConversation,
  withResumeArgs,
  stripOpeningPrompt,
  planRestore,
  type SessionSnapshotMap
} from '../sessionRestore.js';

function session(over: Partial<TerminalSession>): TerminalSession {
  return {
    id: 'sid',
    projectId: 'p1',
    title: 'claude',
    profile: 'claude',
    cwd: '/work/p1',
    status: 'running',
    createdAt: 0,
    ...over
  };
}

function project(over: Partial<Project>): Project {
  return {
    id: 'p1',
    name: 'p1',
    path: '/work/p1',
    createdAt: 0,
    lastActiveAt: 0,
    ...over
  };
}

describe('snapshotTabs', () => {
  it('preserves named worktree identity for authorized restore', () => {
    const worktreeSession = session({
      worktree: { path: '/worktrees/p1/task', branch: 'zcc/task' },
      cwd: '/worktrees/p1/task'
    });
    expect(snapshotTabs([worktreeSession])[0]).toMatchObject({
      worktree: { path: '/worktrees/p1/task', branch: 'zcc/task' },
      cwd: '/worktrees/p1/task'
    });
  });
  it('captures profile/title/extraArgs/cwd/pinned/claudeSessionId for visible tabs', () => {
    const snap = snapshotTabs([
      session({
        id: 'a',
        profile: 'claude',
        title: 'c',
        cwd: '/work/p1',
        pinned: true,
        autoTitledByLlm: true,
        claudeSessionId: 'sess-a'
      }),
      session({ id: 'b', profile: 'shell', title: 'sh', extraArgs: ['--foo'] })
    ]);
    expect(snap).toEqual([
      {
        profile: 'claude',
        title: 'c',
        extraArgs: undefined,
        cwd: '/work/p1',
        pinned: true,
        titleLocked: undefined,
        autoTitledByLlm: true,
        autoTitledByOsc: undefined,
        claudeSessionId: 'sess-a'
      },
      {
        profile: 'shell',
        title: 'sh',
        extraArgs: ['--foo'],
        cwd: '/work/p1',
        pinned: undefined,
        titleLocked: undefined,
        autoTitledByLlm: undefined,
        autoTitledByOsc: undefined,
        claudeSessionId: undefined
      }
    ]);
  });

  it('captures the auto-title pins so a restored auto-named tab is not re-renamed', () => {
    const snap = snapshotTabs([
      session({ id: 'a', autoTitledByOsc: true }),
      session({ id: 'b', autoTitledByLlm: true })
    ]);
    expect(snap[0]).toMatchObject({ autoTitledByOsc: true, autoTitledByLlm: undefined });
    expect(snap[1]).toMatchObject({ autoTitledByLlm: true, autoTitledByOsc: undefined });
  });

  it('strips the opening prompt so restore resumes instead of re-issuing it', () => {
    const snap = snapshotTabs([
      session({ id: 'a', extraArgs: ['Look at the repo…'] })
    ]);
    // The prompt positional must not survive into the snapshot.
    expect(snap[0].extraArgs).toBeUndefined();
  });

  it('keeps the resume pin while dropping the prompt', () => {
    const snap = snapshotTabs([
      session({ id: 'a', extraArgs: ['--resume', 'sess-a', 'do the thing'] })
    ]);
    expect(snap[0].extraArgs).toEqual(['--resume', 'sess-a']);
  });

  it('drops headless (background) tabs', () => {
    const snap = snapshotTabs([
      session({ id: 'a' }),
      session({ id: 'b', headless: true })
    ]);
    expect(snap).toHaveLength(1);
    expect(snap[0]).toMatchObject({ profile: 'claude' });
  });

  it('captures headless Team workers for lifecycle restoration', () => {
    const snap = snapshotTabs([
      session({
        id: 'worker',
        headless: true,
        restoreCapabilityId: 'restore-worker',
        cohort: {
          cohortId: 'cohort-1', teamId: 'team-1', teamName: 'Team',
          role: 'worker', slotId: 'slot-1'
        }
      })
    ]);

    expect(snap).toHaveLength(1);
    expect(snap[0]).toMatchObject({ restoreCapabilityId: 'restore-worker' });
  });

  it('drops exited tabs so a session the user let die is not resurrected', () => {
    const snap = snapshotTabs([
      session({ id: 'a', status: 'running' }),
      session({ id: 'b', status: 'exited', exitCode: 0 })
    ]);
    expect(snap).toHaveLength(1);
    expect(snap[0].profile).toBe('claude');
  });
});

describe('stripOpeningPrompt', () => {
  it('removes OpenCode --prompt forms so restore cannot replay the original task', () => {
    expect(stripOpeningPrompt(['--prompt', 'launch a team'])).toBeUndefined();
    expect(stripOpeningPrompt(['--model', 'aisuite/gpt', '--prompt=launch a team'])).toEqual([
      '--model', 'aisuite/gpt'
    ]);
  });

  it('drops a bare positional prompt', () => {
    expect(stripOpeningPrompt(['just do this thing'])).toBeUndefined();
  });

  it('drops a dash-prefixed prompt guarded by the -- marker', () => {
    expect(stripOpeningPrompt(['--', '-rf is scary, explain it'])).toBeUndefined();
  });

  it('keeps flags and drops a trailing prompt', () => {
    expect(stripOpeningPrompt(['--model', 'opus', 'go fix the bug'])).toEqual([
      '--model',
      'opus'
    ]);
  });

  it('keeps --resume <uuid> and drops the prompt after it', () => {
    expect(stripOpeningPrompt(['--resume', 'sess-1', 'continue please'])).toEqual([
      '--resume',
      'sess-1'
    ]);
  });

  it('keeps bare resume/continue flags', () => {
    expect(stripOpeningPrompt(['--continue'])).toEqual(['--continue']);
    expect(stripOpeningPrompt(['-c'])).toEqual(['-c']);
  });

  it('strips a prompt that a prior restore pushed left of a trailing --continue', () => {
    // Real on-disk shape: ["<prompt>", "--continue"] — the prompt is no longer
    // last because withResumeArgs already appended the flag once.
    expect(stripOpeningPrompt(['I have a few tickets…', '--continue'])).toEqual(['--continue']);
  });

  it('strips a prompt left of a trailing --resume <uuid> and keeps the pin', () => {
    expect(stripOpeningPrompt(['do the thing', '--resume', 'sess-1'])).toEqual([
      '--resume',
      'sess-1'
    ]);
  });

  it('does NOT corrupt an unknown value-flag whose value is trailing (no prompt)', () => {
    // The bug the reviewer flagged: --model is not a resume flag, so its value
    // must not be mistaken for an opening prompt and dropped.
    expect(stripOpeningPrompt(['--model', 'opus'])).toEqual(['--model', 'opus']);
  });

  it('passes through empty / undefined unchanged', () => {
    expect(stripOpeningPrompt(undefined)).toBeUndefined();
    expect(stripOpeningPrompt([])).toEqual([]);
  });
});

describe('shouldResumeConversation', () => {
  it('is true for every claude-family profile', () => {
    expect(shouldResumeConversation('claude')).toBe(true);
    expect(shouldResumeConversation('claude-resume')).toBe(true);
    expect(shouldResumeConversation('claude-yolo')).toBe(true);
  });
  it('is false for shell', () => {
    expect(shouldResumeConversation('shell')).toBe(false);
  });
});

describe('withResumeArgs', () => {
  it('resumes the tab’s OWN session id when known', () => {
    expect(withResumeArgs('claude', undefined, 'sess-a')).toEqual(['--resume', 'sess-a']);
  });

  it('preserves existing args and appends --resume <id>', () => {
    expect(withResumeArgs('claude-yolo', ['--model', 'opus'], 'sess-b')).toEqual([
      '--model',
      'opus',
      '--resume',
      'sess-b'
    ]);
  });

  it('falls back to --continue for a legacy snapshot with no captured id', () => {
    expect(withResumeArgs('claude', undefined)).toEqual(['--continue']);
    expect(withResumeArgs('claude-yolo', ['--model', 'opus'])).toEqual([
      '--model',
      'opus',
      '--continue'
    ]);
  });

  it('leaves shell args untouched', () => {
    expect(withResumeArgs('shell', ['--login'], 'sess-x')).toEqual(['--login']);
    expect(withResumeArgs('shell', undefined)).toBeUndefined();
  });

  it('does not double-add a resume flag', () => {
    expect(withResumeArgs('claude', ['--continue'], 'sess-a')).toEqual(['--continue']);
    expect(withResumeArgs('claude', ['-c'])).toEqual(['-c']);
  });

  it('does not fight an explicit --resume <id> pin (even with a captured id)', () => {
    expect(withResumeArgs('claude', ['--resume', 'sess-123'], 'sess-other')).toEqual([
      '--resume',
      'sess-123'
    ]);
  });

  it('respects =-joined resume/continue forms', () => {
    expect(withResumeArgs('claude', ['--resume=sess-123'])).toEqual(['--resume=sess-123']);
    expect(withResumeArgs('claude', ['--continue=1'])).toEqual(['--continue=1']);
  });
});

describe('planRestore', () => {
  const snapshot: SessionSnapshotMap = {
    p1: [
      { profile: 'claude', title: 'c', cwd: '/work/p1' },
      { profile: 'shell', title: 'sh' }
    ]
  };

  it('plans a spawn per remembered tab, folding --continue into claude tabs with no id', () => {
    const plan = planRestore(snapshot, [project({ id: 'p1' })], {});
    expect(plan).toHaveLength(2);
    expect(plan[0]).toMatchObject({ projectId: 'p1', profile: 'claude', extraArgs: ['--continue'] });
    expect(plan[1]).toMatchObject({ projectId: 'p1', profile: 'shell' });
    expect(plan[1].extraArgs).toBeUndefined();
  });

  it('resumes each claude tab’s OWN conversation when ids were captured', () => {
    const snap: SessionSnapshotMap = {
      p1: [
        { profile: 'claude', title: 'a', cwd: '/work/p1', claudeSessionId: 'sess-a' },
        { profile: 'claude', title: 'b', cwd: '/work/p1', claudeSessionId: 'sess-b' }
      ]
    };
    const plan = planRestore(snap, [project({ id: 'p1' })], {});
    expect(plan).toHaveLength(2);
    // The whole point of the fix: two tabs in one cwd resume DISTINCT sessions,
    // not the same most-recent one.
    expect(plan[0].extraArgs).toEqual(['--resume', 'sess-a']);
    expect(plan[1].extraArgs).toEqual(['--resume', 'sess-b']);
  });

  it('heals a dirty on-disk snapshot that still carries the opening prompt', () => {
    // Snapshot written before snapshotTabs stripped the prompt: the prompt is a
    // positional in extraArgs and the tab has its own captured id. Restore must
    // resume that id, NOT replay the prompt as a fresh first turn.
    const snap: SessionSnapshotMap = {
      p1: [
        {
          profile: 'claude',
          title: 'Claude Code',
          extraArgs: ['Look at the repo…'],
          cwd: '/work/p1',
          claudeSessionId: 'sess-a'
        }
      ]
    };
    const plan = planRestore(snap, [project({ id: 'p1' })], {});
    expect(plan).toHaveLength(1);
    expect(plan[0].extraArgs).toEqual(['--resume', 'sess-a']);
  });

  it('heals a dirty legacy snapshot (prompt, no id) down to --continue', () => {
    const snap: SessionSnapshotMap = {
      p1: [{ profile: 'claude', title: 'c', extraArgs: ['do the thing'], cwd: '/work/p1' }]
    };
    const plan = planRestore(snap, [project({ id: 'p1' })], {});
    expect(plan[0].extraArgs).toEqual(['--continue']);
  });

  it('heals a doubly-dirty snapshot (prompt + already-appended --continue)', () => {
    // The worst on-disk shape: a prior restore already appended --continue AFTER
    // the prompt, so the prompt sits left of the flag. Strip must still find and
    // drop it, and withResumeArgs must not double-add the flag.
    const snap: SessionSnapshotMap = {
      p1: [
        { profile: 'claude', title: 'c', extraArgs: ['I have a few tickets…', '--continue'], cwd: '/work/p1' }
      ]
    };
    const plan = planRestore(snap, [project({ id: 'p1' })], {});
    expect(plan[0].extraArgs).toEqual(['--continue']);
  });

  it('resumes a codex tab via the codex-resume profile + positional id (not a flag)', () => {
    // Codex resume is a POSITIONAL subcommand, so the id must ride resumeSessionId,
    // NOT extraArgs (which the launcher would append as flags). The profile also
    // switches to codex-resume so resolveLaunch emits `resume <id>`.
    const snap: SessionSnapshotMap = {
      p1: [{ profile: 'codex', title: 'x', cwd: '/work/p1', codexSessionId: 'roll-uuid-1' }]
    };
    const plan = planRestore(snap, [project({ id: 'p1' })], {});
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      profile: 'codex-resume',
      resumeSessionId: 'roll-uuid-1'
    });
    // The id never leaks into extraArgs — codex can't take it as a flag.
    expect(plan[0].extraArgs ?? []).not.toContain('roll-uuid-1');
  });

  it('falls back to codex-resume with no id (→ resume --last) when none was captured', () => {
    const snap: SessionSnapshotMap = {
      p1: [{ profile: 'codex', title: 'x', cwd: '/work/p1' }]
    };
    const plan = planRestore(snap, [project({ id: 'p1' })], {});
    expect(plan[0]).toMatchObject({ profile: 'codex-resume' });
    expect(plan[0].resumeSessionId).toBeUndefined();
  });

  it('resumes an opencode tab via the opencode-resume profile + --session id (not extraArgs)', () => {
    const snap: SessionSnapshotMap = {
      p1: [{ profile: 'opencode', title: 'x', cwd: '/work/p1', openCodeSessionId: 'ses_abc123' }]
    };
    const plan = planRestore(snap, [project({ id: 'p1' })], {});
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      profile: 'opencode-resume',
      resumeSessionId: 'ses_abc123'
    });
    expect(plan[0].extraArgs ?? []).not.toContain('ses_abc123');
  });

  it('falls back to opencode-resume with no id (→ --continue) when none was captured', () => {
    const snap: SessionSnapshotMap = {
      p1: [{ profile: 'opencode', title: 'x', cwd: '/work/p1' }]
    };
    const plan = planRestore(snap, [project({ id: 'p1' })], {});
    expect(plan[0]).toMatchObject({ profile: 'opencode-resume' });
    expect(plan[0].resumeSessionId).toBeUndefined();
  });

  it('skips projects that no longer exist', () => {
    expect(planRestore(snapshot, [], {})).toEqual([]);
  });

  it('skips remote (ssh) projects', () => {
    const plan = planRestore(
      snapshot,
      [project({ id: 'p1', remote: { host: 'box', user: 'me' } })],
      {}
    );
    expect(plan).toEqual([]);
  });

  it('skips a project that already has live sessions (renderer reload, not fresh launch)', () => {
    const plan = planRestore(snapshot, [project({ id: 'p1' })], {
      p1: [session({ id: 'already-live' })]
    });
    expect(plan).toEqual([]);
  });

  it('skips a project whose hydration failed (can\'t tell if it has live ptys)', () => {
    const plan = planRestore(snapshot, [project({ id: 'p1' })], {}, new Set(['p1']));
    expect(plan).toEqual([]);
  });

  it('restores other projects even when one is already live', () => {
    const snap: SessionSnapshotMap = {
      p1: [{ profile: 'claude', title: 'c' }],
      p2: [{ profile: 'shell', title: 'sh' }]
    };
    const plan = planRestore(snap, [project({ id: 'p1' }), project({ id: 'p2' })], {
      p1: [session({ id: 'live' })]
    });
    expect(plan).toHaveLength(1);
    expect(plan[0].projectId).toBe('p2');
  });
});
