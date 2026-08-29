import { describe, expect, it } from 'vitest';
import { flagValue, hasFlag, splitSentinel, stripFlags } from './flag-parse.js';
import { renderGuide } from './guide-chapters.js';
import { runGuideCommand } from './commands/guide.js';

describe('flag-parse', () => {
  it('reads space and equals forms', () => {
    expect(flagValue(['--project', 'p1'], '--project')).toBe('p1');
    expect(flagValue(['--project=p1'], '--project')).toBe('p1');
    expect(flagValue(['--project='], '--project')).toBeUndefined();
    expect(flagValue(['--project'], '--project')).toBeUndefined();
  });

  it('strips value and boolean flags', () => {
    expect(stripFlags(
      ['p1', '--wait', '--project', 'x', 'hello'],
      ['--project'],
      ['--wait']
    )).toEqual(['p1', 'hello']);
  });

  it('splits on the first -- sentinel', () => {
    expect(splitSentinel(['a', '--', '--wait', 'b'])).toEqual({
      head: ['a'],
      tail: ['--wait', 'b']
    });
    expect(hasFlag(['--wait'], '--wait')).toBe(true);
  });
});

describe('guide', () => {
  it('renders overview and a named chapter', async () => {
    const overview = await runGuideCommand(undefined, false);
    expect(overview.exitCode).toBe(0);
    expect(overview.stdout).toContain('zcc is the command-line interface');
    const threads = await runGuideCommand('threads', false);
    expect(threads.stdout).toContain('zcc thread spawn');
    const json = await runGuideCommand(undefined, true);
    expect(JSON.parse(json.stdout).chapters).toContain('threads');
  });

  it('rejects unknown chapters', async () => {
    const result = await runGuideCommand('nope', false);
    expect(result.exitCode).toBe(2);
    expect(renderGuide('nope').id).toBe('unknown');
  });
});
