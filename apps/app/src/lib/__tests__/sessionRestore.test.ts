import { describe, it, expect } from 'vitest';
import {
  shouldResumeConversation,
  withResumeArgs,
  stripOpeningPrompt,
  resolveRestartProfile
} from '../sessionRestore.js';

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

describe('resolveRestartProfile', () => {
  it('resumes a claude tab via --resume <id>', () => {
    expect(resolveRestartProfile('claude', undefined, 'sess-a', undefined, undefined)).toMatchObject({
      profile: 'claude',
      extraArgs: ['--resume', 'sess-a']
    });
  });

  it('resumes a codex tab via the codex-resume profile + positional id (not a flag)', () => {
    const resolved = resolveRestartProfile('codex', undefined, undefined, 'roll-uuid-1', undefined);
    expect(resolved).toMatchObject({
      profile: 'codex-resume',
      resumeSessionId: 'roll-uuid-1'
    });
    expect(resolved.extraArgs ?? []).not.toContain('roll-uuid-1');
  });

  it('falls back to codex-resume with no id (→ resume --last) when none was captured', () => {
    const resolved = resolveRestartProfile('codex', undefined, undefined, undefined, undefined);
    expect(resolved).toMatchObject({ profile: 'codex-resume' });
    expect(resolved.resumeSessionId).toBeUndefined();
  });

  it('resumes an opencode tab via the opencode-resume profile + session id (not extraArgs)', () => {
    const resolved = resolveRestartProfile('opencode', undefined, undefined, undefined, 'ses_abc123');
    expect(resolved).toMatchObject({
      profile: 'opencode-resume',
      resumeSessionId: 'ses_abc123'
    });
    expect(resolved.extraArgs ?? []).not.toContain('ses_abc123');
  });

  it('falls back to opencode-resume with no id (→ --continue) when none was captured', () => {
    const resolved = resolveRestartProfile('opencode', undefined, undefined, undefined, undefined);
    expect(resolved).toMatchObject({ profile: 'opencode-resume' });
    expect(resolved.resumeSessionId).toBeUndefined();
  });
});
