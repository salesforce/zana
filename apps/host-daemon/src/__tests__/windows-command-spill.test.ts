import { describe, expect, it } from 'vitest';
import { spillSystemPromptLayers } from '../harness/windows-command.js';

describe('spillSystemPromptLayers', () => {
  it('joins every layer in order and puts the file flag where the first layer was', () => {
    let written = '';
    const out = spillSystemPromptLayers(
      ['--a', '--append-system-prompt', 'one', '--b', '--append-system-prompt', 'two', 'kickoff'],
      (t) => { written = t; return '/tmp/p.md'; }
    );
    expect(written).toBe('one\n\ntwo');
    expect(out?.args).toEqual(['--a', '--append-system-prompt-file', '/tmp/p.md', '--b', 'kickoff']);
  });

  it('returns null without layers, or when the file cannot be written', () => {
    expect(spillSystemPromptLayers(['--a', 'b'], () => '/x')).toBeNull();
    expect(spillSystemPromptLayers(['--append-system-prompt', 't'], () => null)).toBeNull();
  });

  it('leaves a trailing flag with no value alone', () => {
    expect(spillSystemPromptLayers(['--append-system-prompt'], () => '/x')).toBeNull();
  });
});
