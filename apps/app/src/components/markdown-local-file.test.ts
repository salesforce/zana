import { describe, expect, it } from 'vitest';
import {
  conversationFilePreviewPaths,
  isPreviewableConversationPath,
  isLocalFileMarkdownHref,
  parseInlineFileCodePath,
  parseLocalFileMarkdownHref,
  resolveThreadFilePreviewPath
} from './markdown-local-file.js';
import { parseThreadMentionHref, splitThreadMentionText } from './markdown-thread-mentions.js';

describe('parseLocalFileMarkdownHref', () => {
  it('distinguishes a slash-prefixed Windows drive from a protocol-relative URL', () => {
    expect(isLocalFileMarkdownHref('/D:/repo/report.md')).toBe(true);
    expect(parseLocalFileMarkdownHref('/D:/repo/report.md')).toBe('D:/repo/report.md');
    for (const href of ['//workspace/report.md', '//example.com/report.md']) {
      expect(isLocalFileMarkdownHref(href)).toBe(false);
      expect(parseLocalFileMarkdownHref(href)).toBeNull();
    }
  });

  it.each(['example.com', 'www.github.io', 'report.md'])(
    'leaves an ambiguous bare destination to web navigation: %s', (href) => {
      expect(isLocalFileMarkdownHref(href)).toBe(false);
      expect(parseLocalFileMarkdownHref(href)).toBeNull();
    }
  );

  it.each([
    ['/D:/repo/report.md', 'D:/repo/report.md'],
    ['D:/repo/report%20one.md:12', 'D:/repo/report one.md'],
    ['./docs/שלום%20report.md#L3', './docs/שלום report.md'],
    ['report.md:2', 'report.md'],
    ['report.md#L2', 'report.md'],
    ['file:///D:/repo/report.md:2', 'D:/repo/report.md'],
    ['/tmp/100%25.md', '/tmp/100%.md']
  ])('normalizes the file target %s', (href, path) => {
    expect(parseLocalFileMarkdownHref(href)).toBe(path);
  });

  it.each([
    '/D:/repo/%2e%2e/private.md', '/tmp/a%2fb.md', '/tmp/a%5cb.md',
    '/tmp/bad%zz.md', '/tmp/a%00.md', '/tmp/a%0a.md',
    'D:relative.md', '//server/share/report.md', '\\\\server\\share\\report.md',
    'file:///D:/repo/%2e%2e/private.md', 'file://server/share/report.md',
    'file:///tmp/a%2fb.md', '/tmp/a.md:0', '/tmp/a.md#L0',
    '/tmp/a.md:9007199254740992'
  ])('rejects unsafe or malformed local target %s', (href) => {
    expect(parseLocalFileMarkdownHref(href)).toBeNull();
  });

  it('accepts file URLs and absolute paths with a file extension', () => {
    expect(parseLocalFileMarkdownHref('file:///workspace/README.md')).toBe('/workspace/README.md');
    expect(parseLocalFileMarkdownHref('/tmp/app.ts')).toBe('/tmp/app.ts');
    expect(parseLocalFileMarkdownHref('./src/foo.ts')).toBe('./src/foo.ts');
  });

  it('normalizes a local Windows drive file URL before preview confinement', () => {
    expect(parseLocalFileMarkdownHref('file:///D:/Dev/code/zana/docs/getting-started.md'))
      .toBe('D:/Dev/code/zana/docs/getting-started.md');
  });

  it('accepts absolute Windows drive paths without treating drive-relative paths as absolute', () => {
    expect(parseLocalFileMarkdownHref('D:\\Dev\\code\\zana\\docs\\getting-started.md'))
      .toBe('D:/Dev/code/zana/docs/getting-started.md');
    expect(parseLocalFileMarkdownHref('D:docs\\getting-started.md')).toBeNull();
  });

  it('rejects non-local file URL authorities and encoded path separators', () => {
    expect(parseLocalFileMarkdownHref('file://server/share/report.md')).toBeNull();
    expect(parseLocalFileMarkdownHref('file:///workspace/docs%2Freport.md')).toBeNull();
  });

  it('rejects http(s) and parent-segment escapes', () => {
    expect(parseLocalFileMarkdownHref('https://example.com/app.ts')).toBeNull();
    expect(parseLocalFileMarkdownHref('/tmp/../etc/passwd')).toBeNull();
    expect(parseLocalFileMarkdownHref('file:///D:\\work\\repo\\..\\outside.md')).toBeNull();
  });
});

describe('conversationFilePreviewPaths', () => {
  it.each(['Updated the and/or logic in v2.5', 'Updated the and/or logic in report.md']) (
    'does not discover a file in ordinary prose: %s', (text) => {
      expect(conversationFilePreviewPaths(text)).toEqual([]);
    }
  );

  it('allows spaces in explicitly rooted paths and supplied attachment paths', () => {
    expect(conversationFilePreviewPaths('./docs/my report.md\n/D:/repo/my report.md'))
      .toEqual(['./docs/my report.md', 'D:/repo/my report.md']);
    expect(conversationFilePreviewPaths('body', ['docs/my report.md'])).toEqual(['docs/my report.md']);
  });
  it('picks a workspace-relative path from the top of an assistant dump', () => {
    const dump = [
      'docs/architecture/high-level-architecture.md',
      '',
      '# Zana',
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

describe('parseInlineFileCodePath', () => {
  it('accepts bare filenames and slash paths with a letter-starting extension', () => {
    expect(parseInlineFileCodePath('student-to-software-engineer.md')).toBe(
      'student-to-software-engineer.md'
    );
    expect(parseInlineFileCodePath('`docs/guide.md`')).toBe('docs/guide.md');
    expect(parseInlineFileCodePath('src/lib/foo.ts')).toBe('src/lib/foo.ts');
    expect(parseInlineFileCodePath('package.json')).toBe('package.json');
  });

  it('rejects commands, version tokens, and parent-segment escapes', () => {
    expect(parseInlineFileCodePath('true')).toBeNull();
    expect(parseInlineFileCodePath('pnpm test')).toBeNull();
    expect(parseInlineFileCodePath('v1.2.3')).toBeNull();
    expect(parseInlineFileCodePath('../etc/passwd')).toBeNull();
    expect(parseInlineFileCodePath('https://example.com/app.ts')).toBeNull();
    expect(parseInlineFileCodePath('student-to-software-engineer.md\n')).toBeNull();
  });
});

describe('resolveThreadFilePreviewPath', () => {
  it('returns slash paths as-is and unmatched bare names as-is', () => {
    expect(resolveThreadFilePreviewPath('docs/guide.md', ['other/guide.md'])).toBe('docs/guide.md');
    expect(resolveThreadFilePreviewPath('notes.md')).toBe('notes.md');
    expect(resolveThreadFilePreviewPath('true')).toBeNull();
  });

  it('maps a bare name only when the known path has one distinct basename match', () => {
    expect(
      resolveThreadFilePreviewPath('foo.md', ['src/a.ts', 'docs/foo.md'])
    ).toBe('docs/foo.md');
    expect(
      resolveThreadFilePreviewPath('foo.md', ['docs/foo.md', 'lib/foo.md'])
    ).toBe('foo.md');
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

describe('isPreviewableConversationPath', () => {
  const roots = ['/home/u/.notes/'];
  it('keeps relative safe paths', () => {
    expect(isPreviewableConversationPath('docs/a.md')).toBe(true);
  });
  it('rejects home, shell-dynamic, backtick, traversal and NUL paths', () => {
    for (const p of ['~/a.md', '$HOME/a.md', '`x`/a.md', '../a.md', 'a/../b.md', '/home/u/.notes/../x.md', 'a\0.md', '']) {
      expect(isPreviewableConversationPath(p, roots)).toBe(false);
    }
  });
  it('accepts absolute paths only inside a root on a path boundary', () => {
    expect(isPreviewableConversationPath('/home/u/.notes/a.md', roots)).toBe(true);
    expect(isPreviewableConversationPath('/home/u/.notes-evil/a.md', roots)).toBe(false);
    expect(isPreviewableConversationPath('/etc/a.md', roots)).toBe(false);
    expect(isPreviewableConversationPath('/etc/a.md')).toBe(false);
    expect(isPreviewableConversationPath('C:/x/a.md', roots)).toBe(false);
  });
  it('matches Windows drive-letter paths with either separator, ignoring drive case', () => {
    const win = ['C:\\proj', 'D:/notes/'];
    for (const p of ['C:\\proj\\notes.md', 'C:/proj/notes.md', 'c:\\PROJ\\a.md', 'D:\\notes\\a.md']) {
      expect(isPreviewableConversationPath(p, win)).toBe(true);
    }
    for (const p of ['C:\\proj-evil\\a.md', 'E:\\proj\\a.md', 'C:\\proj\\..\\x.md']) {
      expect(isPreviewableConversationPath(p, win)).toBe(false);
    }
  });
});
