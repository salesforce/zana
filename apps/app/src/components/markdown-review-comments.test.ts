import { describe, expect, it } from 'vitest';
import { parseReviewComments } from './markdown-review-comments.js';

export const REVIEW_EXAMPLE = ':::comment{id="agent-merge-conflict-silent" file="ui-chatbots-components/modules/agent_authoring/modelManager/agentScriptModel.js" lines="17" priority="p1" title="Same-line edits: the collaborator\'s edit is lost without notice"}';

describe('parseReviewComments', () => {
  it('accepts the standalone header emitted by a review', () => {
    expect(parseReviewComments(REVIEW_EXAMPLE)).toEqual([expect.objectContaining({
      title: "Same-line edits: the collaborator's edit is lost without notice",
      file: 'ui-chatbots-components/modules/agent_authoring/modelManager/agentScriptModel.js',
      lines: '17', lineNumber: 17, priority: 'P1', body: '', start: 0, end: REVIEW_EXAMPLE.length
    })]);
  });

  it('preserves exact offsets around multi-paragraph containers, including CRLF', () => {
    const text = `Intro\r\n\r\n${REVIEW_EXAMPLE}\r\nFirst **paragraph**.\r\n\r\nSecond.\r\n:::\r\n\r\nAfter.`;
    const [comment] = parseReviewComments(text);
    expect(comment.body).toBe('First **paragraph**.\r\n\r\nSecond.');
    expect(text.slice(0, comment.start)).toBe('Intro\r\n\r\n');
    expect(text.slice(comment.end)).toBe('\r\nAfter.');
  });

  it('supports multiple comments, including an unclosed streaming tail', () => {
    const text = ':::comment{title="First"}\nbody\n:::comment{title="Second"}\nnew body';
    const comments = parseReviewComments(text);
    expect(comments.map(({ title, body }) => ({ title, body }))).toEqual([
      { title: 'First', body: 'body' }, { title: 'Second', body: 'new body' }
    ]);
    expect(comments[0].end).toBe(comments[1].start);
    expect(comments[1].end).toBe(text.length);
  });

  it('supports quoted braces, escaped quotes, single quotes, and bare values', () => {
    const [comment] = parseReviewComments(String.raw`:::comment{title="Keep {value} and \"quotes\"" file='src/test.js' lines=4-9 priority=P2 }`);
    expect(comment).toMatchObject({ title: 'Keep {value} and "quotes"', file: 'src/test.js', lines: '4-9', lineNumber: 4, priority: 'P2' });
  });

  it.each(['', '0', '-1', '1.5', '17-3', 'NaN', '9007199254740992', '3-9007199254740992'])('ignores invalid line metadata %j without hiding the comment', (lines) => {
    expect(parseReviewComments(`:::comment{title="Finding" lines="${lines}" priority="other"}`)[0]).toMatchObject({ lineNumber: null, priority: null });
  });

  it('defaults optional fields and accepts indentation up to three spaces', () => {
    expect(parseReviewComments("   :::comment{title='  Finding  '}\n:::\n")[0]).toMatchObject({ title: 'Finding', file: '', lines: '', lineNumber: null, priority: null, body: '' });
  });

  it.each([
    ':::comment{title="Incomplete', ':::comment{title=""}', ':::comment{file="src/a.ts"}',
    ':::comment{title="Finding" broken}', ':::comment{title="Finding"} trailing',
    '    :::comment{title="Indented code"}', 'Text :::comment{title="Inline"}',
    '`:::comment{title="Inline code"}`', '::unknown{title="Unknown"}'
  ])('leaves incomplete/malformed/literal source alone: %s', (text) => {
    expect(parseReviewComments(text)).toEqual([]);
  });

  it.each(['```', '~~~~'])('does not interpret examples inside %s fences', (fence) => {
    expect(parseReviewComments(`${fence}md\n${REVIEW_EXAMPLE}\n::: \n${fence}`)).toEqual([]);
  });

  it('keeps colon closers inside fenced comment bodies literal', () => {
    const text = `:::comment{title="Finding"}\n\n\`\`\`md\n:::\n${REVIEW_EXAMPLE}\n\`\`\`\n\nMore.\n:::\nAfter.`;
    const [comment] = parseReviewComments(text);
    expect(comment.body).toContain(REVIEW_EXAMPLE);
    expect(comment.body).toContain('More.');
    expect(text.slice(comment.end)).toBe('After.');
  });
});
