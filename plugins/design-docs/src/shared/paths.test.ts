import { describe, expect, it } from 'vitest';
import {
  MAX_PATH_DEPTH,
  MAX_PATH_LENGTH,
  codeLanguageOf,
  comparePaths,
  extensionOf,
  fileKindOf,
  imageMediaTypeOf,
  isBinaryKind,
  mediaTypeOf,
  isCrossDocScheme,
  normalizeDocPath,
  crossDocMarkdownLink,
  localizeDocLink,
  relativeDocPath,
  parseCrossDocLink,
  resolveDocLink,
  shieldCrossDocLinks,
  unshieldCrossDocHref
} from './paths.js';

describe('normalizeDocPath', () => {
  it('canonicalises agent-style paths', () => {
    expect(normalizeDocPath(' ./././docs\\Flow v2.md ')).toBe('docs/Flow v2.md');
  });

  it.each([
    [42, /must be a string/],
    ['  ', /required/],
    ['./', /required/],
    ['/etc/passwd', /relative/],
    ['a/../b.md', /"\."/],
    ['a/./b.md', /"\."/],
    ['.env', /invalid path segment/],
    ['a//b.md', /invalid path segment/],
    ['trailing. ', /invalid path segment/],
    ['name.', /invalid path segment/],
    ['x'.repeat(MAX_PATH_LENGTH + 1), /at most 160 characters/],
    [Array.from({ length: MAX_PATH_DEPTH + 1 }, () => 'd').join('/'), /levels deep/]
  ])('rejects %j', (input, message) => {
    expect(() => normalizeDocPath(input)).toThrow(message);
  });
});

describe('file kinds', () => {
  it('classifies by extension', () => {
    expect(extensionOf('a/.hidden')).toBe('');
    expect(extensionOf('Makefile')).toBe('');
    expect(fileKindOf('README.MD')).toBe('markdown');
    expect(fileKindOf('flow.mmd')).toBe('mermaid');
    expect(fileKindOf('mock.html')).toBe('html');
    expect(fileKindOf('logo.svg')).toBe('svg');
    expect(fileKindOf('shot.webp')).toBe('image');
    expect(fileKindOf('api.yaml')).toBe('code');
    expect(fileKindOf('LICENSE')).toBe('text');
    expect(codeLanguageOf('Account.cls')).toBe('apex');
    expect(codeLanguageOf('notes.txt')).toBe('');
    expect(isBinaryKind('image')).toBe(true);
    expect(isBinaryKind('svg')).toBe(false);
    expect(imageMediaTypeOf('a.JPG')).toBe('image/jpeg');
    expect(imageMediaTypeOf('a.svg')).toBeNull();
    expect(fileKindOf('fonts/Inter.woff2')).toBe('font');
    expect(fileKindOf('favicon.ico')).toBe('image');
    expect(isBinaryKind('font')).toBe(true);
  });

  it('accepts site-depth paths', () => {
    const deep = 'starting/org-metadata/force-app/main/default/objects/Flight__c/fields/Seat__c.field-meta.xml';
    expect(normalizeDocPath(deep)).toBe(deep);
    expect(MAX_PATH_DEPTH).toBeGreaterThanOrEqual(9);
  });

  it('names a media type for serving each file', () => {
    expect(mediaTypeOf('a.png')).toBe('image/png');
    expect(mediaTypeOf('f/a.woff2')).toBe('font/woff2');
    expect(mediaTypeOf('data.json')).toBe('application/json;charset=utf-8');
    expect(mediaTypeOf('app.mjs')).toBe('text/javascript;charset=utf-8');
    expect(mediaTypeOf('style.css')).toBe('text/css;charset=utf-8');
    expect(mediaTypeOf('runs/final.md')).toBe('text/markdown;charset=utf-8');
    expect(mediaTypeOf('LICENSE')).toBe('text/plain;charset=utf-8');
  });

  it('sorts files before subfolders, naturally', () => {
    const paths = ['b/x.md', 'README.md', 'a/z.md', 'a/b/c.md', 'file10.md', 'file2.md'];
    expect([...paths].sort(comparePaths)).toEqual(['file2.md', 'file10.md', 'README.md', 'a/z.md', 'a/b/c.md', 'b/x.md']);
    expect(comparePaths('a/b', 'a/b')).toBe(0);
  });
});

describe('parseCrossDocLink', () => {
  it('parses canonical and shorthand forms, with path and anchor', () => {
    expect(parseCrossDocLink('doc://my-spec/api/auth.md#tokens')).toEqual({ docRef: 'my-spec', path: 'api/auth.md', anchor: 'tokens' });
    expect(parseCrossDocLink('doc:my-spec/api.md')).toEqual({ docRef: 'my-spec', path: 'api.md', anchor: null });
    expect(parseCrossDocLink('DOC://dd_abc123/My%20File.md?x=1')).toEqual({ docRef: 'dd_abc123', path: 'My File.md', anchor: null });
  });
  it('treats a doc-level link as the entry file', () => {
    expect(parseCrossDocLink('doc://my-spec')).toEqual({ docRef: 'my-spec', path: null, anchor: null });
    expect(parseCrossDocLink('doc://my-spec/#top')).toEqual({ docRef: 'my-spec', path: null, anchor: 'top' });
    expect(parseCrossDocLink('doc:my-spec')).toEqual({ docRef: 'my-spec', path: null, anchor: null });
  });
  it('rejects traversal, empty segments, bad escapes and bad refs', () => {
    for (const href of ['doc://x/../y.md', 'doc://x/a//b.md', 'doc://x/%2e%2e/y.md', 'doc://x/a%2Fb.md', 'doc://x/%E0%A4%A.md',
      'doc://', 'doc:///x', 'doc://-bad/a.md', 'doc://../a.md', 'doc://x/.hidden.md', 'doc://%zz/a.md']) {
      expect(parseCrossDocLink(href), href).toBeNull();
    }
  });
  it('ignores everything that is not the doc scheme', () => {
    for (const href of ['api.md', '#a', 'https://x/y', 'mailto:a@b.c', 'docs/x.md']) expect(parseCrossDocLink(href)).toBeNull();
    expect(isCrossDocScheme(' doc:x')).toBe(true);
    expect(isCrossDocScheme('docs/x')).toBe(false);
  });
  it('leaves resolveDocLink treating doc: as an external scheme', () => {
    expect(resolveDocLink('a.md', 'doc://x/y.md')).toBeNull();
  });
});

describe('shieldCrossDocLinks', () => {
  it('wraps doc: links so the host renderer keeps them, and restores them', () => {
    const shielded = shieldCrossDocLinks('See [API](doc://spec/api.md#top) and [<x>](<doc:a-b>) and [web](https://x.io).');
    expect(shielded).not.toContain('](doc:');
    expect(shielded).toContain('](https://x.io)');
    const hrefs = [...shielded.matchAll(/\]\(([^)]+)\)/g)].map((m) => unshieldCrossDocHref(m[1]!));
    expect(hrefs).toEqual(['doc://spec/api.md#top', 'doc:a-b', 'https://x.io']);
  });

  it('leaves fenced and inline code alone', () => {
    const md = '```md\n[a](doc://x/y)\n```\n`[b](doc://x/y)` then [c](doc://x/y)\n~~~\n[d](doc://x/y)\n~~~';
    const out = shieldCrossDocLinks(md);
    expect(out).toContain('```md\n[a](doc://x/y)\n```');
    expect(out).toContain('`[b](doc://x/y)`');
    expect(out).toContain('~~~\n[d](doc://x/y)\n~~~');
    expect(out).not.toContain('[c](doc://');
  });

  it('accepts spaces inside angle-bracket destinations and round trips them', () => {
    const shielded = shieldCrossDocLinks('[x](<doc://ref/my file.md>) then [y](doc://ref/a.md)');
    expect(shielded).not.toContain('doc:');
    const hrefs = [...shielded.matchAll(/\]\(([^)]+)\)/g)].map((m) => unshieldCrossDocHref(m[1]!));
    expect(hrefs).toEqual(['doc://ref/my file.md', 'doc://ref/a.md']);
    expect(parseCrossDocLink(hrefs[0]!)).toEqual({ docRef: 'ref', path: 'my file.md', anchor: null });
  });

  it('only closes a fence with a bare fence line and skips indented code blocks', () => {
    const open = '```\n``` js\n[a](doc://x/y)\n```\n[b](doc://x/y)';
    const out = shieldCrossDocLinks(open);
    expect(out).toContain('``` js\n[a](doc://x/y)\n```');
    expect(out).not.toContain('[b](doc://');
    const indented = 'para\n\n    [a](doc://x/y)\n    [b](doc://x/y)\n\n[c](doc://x/y)';
    const out2 = shieldCrossDocLinks(indented);
    expect(out2).toContain('    [a](doc://x/y)\n    [b](doc://x/y)');
    expect(out2).not.toContain('[c](doc://');
    expect(shieldCrossDocLinks('text\n    [a](doc://x/y)')).not.toContain('    [a](doc://');
  });

  it('unshield returns other hrefs unchanged and tolerates bad escapes', () => {
    expect(unshieldCrossDocHref('https://x.io')).toBe('https://x.io');
    const bad = 'https://doc-link.invalid/?h=%E0%A4%A';
    expect(unshieldCrossDocHref(bad)).toBe(bad);
  });
});

describe('crossDocMarkdownLink', () => {
  it('builds a link the parser accepts', () => {
    const link = crossDocMarkdownLink({ id: 'dd_abc123', title: 'Auth [v2]\n design', entryPath: 'README.md' });
    expect(link).toBe('[Auth \\[v2\\] design](doc://dd_abc123/README.md)');
    expect(parseCrossDocLink('doc://dd_abc123/README.md')).toEqual({ docRef: 'dd_abc123', path: 'README.md', anchor: null });
  });
  it('links a specific file with its name as label and encodes the path', () => {
    const link = crossDocMarkdownLink({ id: 'dd_x', title: 'T', entryPath: 'README.md' }, 'my diagrams/a b.mmd');
    expect(link).toBe('[a b.mmd](doc://dd_x/my%20diagrams/a%20b.mmd)');
    expect(parseCrossDocLink('doc://dd_x/my%20diagrams/a%20b.mmd')?.path).toBe('my diagrams/a b.mmd');
  });
  it('falls back to the id for an empty title and omits an unknown entry', () => {
    expect(crossDocMarkdownLink({ id: 'dd_x', title: '  ' })).toBe('[dd_x](doc://dd_x)');
  });
});

describe('relativeDocPath', () => {
  it.each([
    ['README.md', 'diagrams/a.mmd', 'diagrams/a.mmd'],
    ['diagrams/a.mmd', 'README.md', '../README.md'],
    ['a/b/c.md', 'a/d/e.md', '../d/e.md'],
    ['a/b.md', 'a/c.md', 'c.md']
  ])('%s -> %s', (from, to, expected) => {
    expect(relativeDocPath(from, to)).toBe(expected);
    expect(resolveDocLink(from, expected)).toBe(to);
  });
});

describe('localizeDocLink', () => {
  it('rewrites a link to this doc as a relative link, keeping label and anchor', () => {
    expect(localizeDocLink('[Flow](doc://dd_1/diagrams/a%20b.mmd#top)', 'dd_1', 'README.md')).toBe('[Flow](diagrams/a%20b.mmd#top)');
    expect(localizeDocLink('  [R](doc://dd_1/README.md)\n', 'dd_1', 'notes/x.md')).toBe('[R](../README.md)');
  });
  it('leaves other docs, entry-less links and ordinary text alone', () => {
    expect(localizeDocLink('[X](doc://dd_2/a.md)', 'dd_1', 'README.md')).toBeNull();
    expect(localizeDocLink('[X](doc://dd_1)', 'dd_1', 'README.md')).toBeNull();
    expect(localizeDocLink('text [X](doc://dd_1/a.md) more', 'dd_1', 'README.md')).toBeNull();
    expect(localizeDocLink('[X](doc://dd_1/../a.md)', 'dd_1', 'README.md')).toBeNull();
  });
});
