import { describe, expect, it } from 'vitest';
import { markdownBlocks, markdownBody, markdownTasks, replaceMarkdownBlock, toggleMarkdownTask } from './markdown-source.js';
import { recallMarkdownDraft, rememberMarkdownDraft } from './markdown-drafts.js';

describe('source-preserving Markdown edits', () => {
  const source = '\uFEFF---\r\ntitle: "Keep  this"\r\n---\r\n\r\n# Heading ##\r\n\r\n<!-- untouched -->\r\n\r\n> - [X] duplicate\r\n>   - [ ] duplicate\r\n\r\n1. [ ] duplicate\r\n\r\n```md\r\n- [ ] fenced\r\n```\r\n';
  it('hides metadata while retaining exact original offsets', () => {
    const { body, offset } = markdownBody(source);
    expect(source.slice(offset)).toBe(body);
    expect(body).toContain('# Heading ##\r\n');
    expect(body).not.toContain('title:');
    expect(body).not.toContain('---');
    const blocks = markdownBlocks(source);
    expect(blocks[0]?.source).toBe('# Heading ##');
    for (const block of blocks) expect(source.slice(block.start, block.end)).toBe(block.source);
    expect(blocks.find(block => block.source.startsWith('<!--'))?.editable).toBe(false);
  });
  it('patches only the parsed marker, including nested quoted and ordered tasks', () => {
    const tasks = [...markdownTasks(source)];
    expect(tasks).toHaveLength(3);
    tasks.forEach(([start, task]) => {
      const changed = toggleMarkdownTask(source, start, task.marker === ' ');
      expect(changed.slice(0, task.offset)).toBe(source.slice(0, task.offset));
      expect(changed.slice(task.offset + 1)).toBe(source.slice(task.offset + 1));
      expect(changed[task.offset]).toBe(task.marker === ' ' ? 'x' : ' ');
    });
    expect(toggleMarkdownTask(source, -1, true)).toBe(source);
  });
  it('splices a changed block and preserves all untouched bytes and CRLF', () => {
    const block = markdownBlocks(source)[0]!;
    const next = replaceMarkdownBlock(source, block, '# New\n\nMore');
    expect(next).toBe(source.slice(0, block.start) + '# New\r\n\r\nMore' + source.slice(block.end));
    expect(replaceMarkdownBlock('changed' + source, block, 'oops')).toBeNull();
    expect(replaceMarkdownBlock('hello', markdownBlocks('hello')[0]!, 'world')).toBe('world');
  });
  it('keeps unsupported syntax opaque instead of round-tripping it', () => {
    for (const input of ['[reference][id]\n\n[id]: /keep "title"', '<!-- comment -->', '```mermaid\ngraph TD; A-->B\n```', 'With $x^2$ math', '![image](asset.png)']) {
      expect(markdownBlocks(input).every(block => !block.editable)).toBe(true);
    }
    expect(markdownBlocks('# Heading\n\n**Bold**\n\n- [ ] Task\n\n| a | b |\n| - | - |\n| 1 | 2 |').every(block => block.editable)).toBe(true);
    expect(markdownBody('plain')).toEqual({ body: 'plain', offset: 0 });
    expect(markdownBody('---\r\n---\r\nBody')).toEqual({ body: 'Body', offset: 10 });
    expect(markdownBody('---\nkey: value\n...\nBody').body).toBe('Body');
    expect(markdownBody('---\nnot metadata').body).toBe('---\nnot metadata');
    expect(markdownBlocks('')).toEqual([]);
  });
});

it('retains dirty drafts by exact identity with bounded eviction and clears saved ones', () => {
  rememberMarkdownDraft('one', { content: 'base', draft: 'mine', sha256: 'a' });
  expect(recallMarkdownDraft('two')).toBeUndefined();
  expect(recallMarkdownDraft('one')?.draft).toBe('mine');
  rememberMarkdownDraft('one', { content: 'mine', draft: 'mine' });
  expect(recallMarkdownDraft('one')).toBeUndefined();
  for (let i = 0; i < 33; i++) rememberMarkdownDraft(`item${i}`, { content: '', draft: 'dirty' });
  expect(recallMarkdownDraft('item0')).toBeUndefined();
  expect(recallMarkdownDraft('item32')?.draft).toBe('dirty');
  rememberMarkdownDraft('large', { content: '', draft: 'x'.repeat(5 * 1024 * 1024) });
  expect(recallMarkdownDraft('large')).toBeUndefined();
});
