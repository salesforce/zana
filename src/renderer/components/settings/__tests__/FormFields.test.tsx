import { describe, it, expect } from 'vitest';
import { tokenizeArgsLine } from '../FormFields';

/**
 * Pins the fix for "Extra args" splicing a whole `--flag value` string into
 * argv as ONE token (e.g. `claude --plugin-dir /some/path` failing with
 * `unknown option '--plugin-dir /some/path'`). "Extra args" now uses
 * `TextArgsField` — a single text box, not a chip-per-token UI — and
 * `tokenizeArgsLine` is what turns that one line into the `string[]` every
 * launch path expects, splitting on whitespace like a shell would.
 */
describe('tokenizeArgsLine', () => {
  it('splits a flag and its value into separate tokens', () => {
    expect(tokenizeArgsLine('--plugin-dir /Users/grebmann/dummy-test-plugin')).toEqual([
      '--plugin-dir',
      '/Users/grebmann/dummy-test-plugin'
    ]);
  });

  it('splits multiple space-separated flags on one line', () => {
    expect(tokenizeArgsLine('--verbose --plugin-dir /a/b --add-dir /c/d')).toEqual([
      '--verbose',
      '--plugin-dir',
      '/a/b',
      '--add-dir',
      '/c/d'
    ]);
  });

  it('keeps a quoted segment with an embedded space as one token', () => {
    expect(tokenizeArgsLine('--plugin-dir "/Users/grebmann/My Plugin"')).toEqual([
      '--plugin-dir',
      '/Users/grebmann/My Plugin'
    ]);
  });

  it('collapses repeated whitespace and ignores empty input', () => {
    expect(tokenizeArgsLine('  --plugin-dir    /a/b  ')).toEqual(['--plugin-dir', '/a/b']);
    expect(tokenizeArgsLine('   ')).toEqual([]);
  });
});
