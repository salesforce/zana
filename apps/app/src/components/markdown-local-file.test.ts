import { describe, expect, it } from 'vitest';
import { parseLocalFileMarkdownHref } from './markdown-local-file.js';
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
