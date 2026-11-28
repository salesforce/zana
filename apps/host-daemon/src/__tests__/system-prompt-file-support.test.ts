import { beforeEach, describe, expect, it } from 'vitest';
import {
  claudeSupportsAppendSystemPromptFile,
  helpMentionsAppendSystemPromptFile,
  resetSystemPromptFileSupportCacheForTests
} from '../harness/claude/system-prompt-file-support.js';

describe('claudeSupportsAppendSystemPromptFile', () => {
  beforeEach(() => resetSystemPromptFileSupportCacheForTests());

  it('detects the flag or the [-file] shorthand in help text', () => {
    expect(helpMentionsAppendSystemPromptFile('  --append-system-prompt-file <path>')).toBe(true);
    expect(helpMentionsAppendSystemPromptFile('--system-prompt[-file], --append-system-prompt[-file], --add-dir')).toBe(true);
    expect(helpMentionsAppendSystemPromptFile('  --append-system-prompt <prompt>')).toBe(false);
  });

  it('caches the verdict per binary and treats a failing probe as unsupported', () => {
    let calls = 0;
    const ok = (): string => { calls++; return '--append-system-prompt[-file]'; };
    expect(claudeSupportsAppendSystemPromptFile('a', ok)).toBe(true);
    expect(claudeSupportsAppendSystemPromptFile('a', ok)).toBe(true);
    expect(calls).toBe(1);
    expect(claudeSupportsAppendSystemPromptFile('b', () => { throw new Error('missing'); })).toBe(false);
    expect(claudeSupportsAppendSystemPromptFile('c', () => 'old help')).toBe(false);
  });
});
