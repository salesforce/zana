import { describe, expect, it } from 'vitest';
import { isSoqlCommentLine, stripSoqlComments } from '../lib/strip-soql-comments.js';

describe('stripSoqlComments', () => {
  it('blanks full-line hash and dash comments while preserving line count', () => {
    const soql = ['SELECT Id', '-- skip', 'FROM Account', '# also skip', "WHERE Name = 'a -- not a comment'"].join(
      '\n'
    );
    expect(isSoqlCommentLine('  -- skip')).toBe(true);
    expect(isSoqlCommentLine("WHERE Name = 'x'")).toBe(false);
    expect(stripSoqlComments(soql).split('\n')).toEqual([
      'SELECT Id',
      '',
      'FROM Account',
      '',
      "WHERE Name = 'a -- not a comment'"
    ]);
  });

  it('returns empty input unchanged', () => {
    expect(stripSoqlComments('')).toBe('');
  });
});
