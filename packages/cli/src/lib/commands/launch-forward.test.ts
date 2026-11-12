import { describe, expect, it } from 'vitest';
import { launchOptionsFromFlags } from './launch-forward.js';

describe('launchOptionsFromFlags', () => {
  it('keeps inheritance absent and supports explicit boolean forms', () => {
    expect(launchOptionsFromFlags([])).toEqual({});
    expect(launchOptionsFromFlags(['--worktree', '--push'])).toEqual({ worktree: true, push: true });
    expect(launchOptionsFromFlags(['--no-worktree', '--no-push'])).toEqual({ worktree: false, push: false });
    expect(launchOptionsFromFlags(['--worktree', 'false', '--push=true'])).toEqual({ worktree: false, push: true });
    expect(launchOptionsFromFlags(['--target=project-root'])).toEqual({ target: { kind: 'project-root' } });
  });
  it.each([
    ['--worktree', '--no-worktree'], ['--push', '--no-push'], ['--on-complete'],
    ['--failure-policy-default'], ['--check'], ['--target'], ['--target='],
    ['--check', 'unit', '--check'], ['--worktree='], ['--push=']
  ])('rejects malformed flags %s', (...args) => {
    expect(() => launchOptionsFromFlags(args)).toThrow();
  });
});
