import { describe, expect, it } from 'vitest';
import { conversationFilePreviewPaths, parseLocalFileMarkdownHref } from './markdown-local-file.js';
import { parseThreadMentionHref, splitThreadMentionText } from './markdown-thread-mentions.js';

describe('parseLocalFileMarkdownHref', () => {
  it('accepts file URLs and absolute paths with a file extension', () => {
    expect(parseLocalFileMarkdownHref('file:///workspace/README.md')).toBe('/workspace/README.md');
    expect(parseLocalFileMarkdownHref('/tmp/app.ts')).toBe('/tmp/app.ts');
    expect(parseLocalFileMarkdownHref('./src/foo.ts')).toBe('./src/foo.ts');
  });

  it('rejects http(s) and parent-segment escapes', () => {
    expect(parseLocalFileMarkdownHref('https://example.com/app.ts')).toBeNull();
    expect(parseLocalFileMarkdownHref('/tmp/../etc/passwd')).toBeNull();
  });
});

describe('conversationFilePreviewPaths', () => {
  it('picks a workspace-relative path from the top of an assistant dump', () => {
    const dump = [
      'docs/architecture/high-level-architecture.md',
      '',
      '# Zana Command Center',
      '',
      'See also packages/thread-view/src/timeline-row-title.ts for titles.'
    ].join('\n');
    expect(conversationFilePreviewPaths(dump)).toEqual([
      'docs/architecture/high-level-architecture.md'
    ]);
  });

  it('accepts backtick wrapping and a File: prefix, and includes attachments', () => {
    expect(conversationFilePreviewPaths('`src/lib/foo.ts`\nbody')).toEqual(['src/lib/foo.ts']);
    expect(conversationFilePreviewPaths('File: docs/guide.md\n# Guide')).toEqual(['docs/guide.md']);
    expect(conversationFilePreviewPaths('# docs/architecture/high-level-architecture.md\n\nbody')).toEqual([
      'docs/architecture/high-level-architecture.md'
    ]);
    expect(conversationFilePreviewPaths('hello', ['notes/todo.md'])).toEqual(['notes/todo.md']);
  });

  it('ignores headings and later body paths', () => {
    expect(conversationFilePreviewPaths('# README.md\n\nhello')).toEqual([]);
    const body = [
      'Here is the doc.',
      '',
      '# Title',
      '',
      'Related: packages/cli/src/lib/run-cli.ts'
    ].join('\n');
    expect(conversationFilePreviewPaths(body)).toEqual([]);
  });
});

describe('thread mention split', () => {
  it('turns @thread tokens into zcc-thread links', () => {
    const nodes = splitThreadMentionText('see @thread:abc_1 later');
    expect(nodes).toEqual([
      { type: 'text', value: 'see ' },
      {
        type: 'link',
        url: 'zcc-thread:abc_1',
        children: [{ type: 'text', value: '@thread:abc_1' }]
      },
      { type: 'text', value: ' later' }
    ]);
    expect(parseThreadMentionHref('zcc-thread:abc_1')).toBe('abc_1');
  });
});
