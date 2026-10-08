import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApi, errorMessage, isConflict, toast } from './api.js';
import {
  buildTree,
  codeFence,
  fenced,
  fileDataUrl,
  formatSubPath,
  inlineImages,
  parseSubPath,
  readThemeTokens,
  referencedImages,
  resolveDocLink,
  themedHtml
} from './content.js';
import { diffStats, foldDiff, lineDiff } from './diff.js';
import { resolveActivePath } from './DocView.js';
import { starterContent, withDefaultExtension } from './FileTree.js';
import { draftingPrompt } from './Workbench.js';
import { formatBytes, relativeTime } from '../shared/display.js';

describe('sub-paths', () => {
  it('round-trips a doc and file location', () => {
    expect(parseSubPath(undefined)).toEqual({ docId: null, path: null });
    expect(parseSubPath('dd_1')).toEqual({ docId: 'dd_1', path: null });
    expect(parseSubPath('/dd_1/diagrams/flow.mmd/')).toEqual({ docId: 'dd_1', path: 'diagrams/flow.mmd' });
    expect(formatSubPath({ docId: null, path: 'x' })).toBe('');
    expect(formatSubPath({ docId: 'dd_1', path: null })).toBe('dd_1');
    expect(formatSubPath({ docId: 'dd_1', path: 'a/b.md' })).toBe('dd_1/a/b.md');
  });
});

describe('resolveDocLink', () => {
  it('resolves relative and root links inside the doc', () => {
    expect(resolveDocLink('README.md', 'api.md')).toBe('api.md');
    expect(resolveDocLink('docs/README.md', './api.md#auth')).toBe('docs/api.md');
    expect(resolveDocLink('docs/deep/a.md', '../b.md?x=1')).toBe('docs/b.md');
    expect(resolveDocLink('docs/a.md', '/assets/logo%20v2.png')).toBe('assets/logo v2.png');
    expect(resolveDocLink('a.md', 'bad%zzname.md')).toBe('bad%zzname.md');
  });

  it('rejects anything outside the doc', () => {
    for (const href of ['', '   ', '#top', '//cdn.example.com/x.png', 'https://example.com', 'mailto:a@b.c', '../outside.md', '.']) {
      expect(resolveDocLink('README.md', href)).toBeNull();
    }
  });
});

describe('images', () => {
  it('builds data URLs for svg and base64 images only', () => {
    expect(fileDataUrl({ path: 'a.svg', kind: 'svg', content: '<svg>é</svg>', encoding: 'utf8' })).toBe(
      `data:image/svg+xml;base64,${Buffer.from('<svg>é</svg>').toString('base64')}`
    );
    expect(fileDataUrl({ path: 'a.png', kind: 'image', content: 'AAAA', encoding: 'base64' })).toBe('data:image/png;base64,AAAA');
    expect(fileDataUrl({ path: 'a.png', kind: 'image', content: 'AAAA', encoding: 'utf8' })).toBeNull();
    expect(fileDataUrl({ path: 'a.md', kind: 'markdown', content: '#', encoding: 'utf8' })).toBeNull();
  });

  it('finds and inlines the images markdown references', () => {
    const markdown = '![one](img/a.png) ![two](<img/b c.png> "Title") ![remote](https://x/y.png) ![again](img/a.png)';
    expect(referencedImages('docs/README.md', markdown)).toEqual(['docs/img/a.png', 'docs/img/b c.png']);
    const assets = new Map([
      ['docs/img/a.png', 'data:A'],
      ['docs/img/b c.png', 'data:B']
    ]);
    expect(inlineImages('docs/README.md', markdown, assets)).toBe(
      '![one](data:A) ![two](data:B "Title") ![remote](https://x/y.png) ![again](data:A)'
    );
    expect(inlineImages('docs/README.md', markdown, new Map())).toBe(markdown);
  });
});

describe('fences', () => {
  it('uses a fence longer than any backtick run', () => {
    expect(fenced('a\n', 'ts')).toBe('```ts\na\n```');
    expect(fenced('x ```` y', '')).toBe('`````\nx ```` y\n`````');
    expect(codeFence('src/main.py', 'print(1)')).toBe('```python\nprint(1)\n```');
  });
});

describe('themedHtml', () => {
  const tokens = { '--accent': '#123', '--bad': 'red;}</style><script>' };

  it('injects the theme first, after <head>, and drops unsafe values', () => {
    const out = themedHtml('<!doctype html><html><head><title>x</title></head></html>', tokens);
    expect(out.startsWith('<!doctype html><html><head><style data-zcc-theme>')).toBe(true);
    expect(out).toContain('--accent: #123;');
    expect(out).not.toContain('--bad');
    expect(out.indexOf('data-zcc-theme')).toBeLessThan(out.indexOf('<title>'));
  });

  it('falls back to after the doctype, then to the start', () => {
    expect(themedHtml('<!DOCTYPE html><p>x</p>', {})).toMatch(/^<!DOCTYPE html><style data-zcc-theme>/);
    expect(themedHtml('<p>x</p>', {})).toMatch(/^<style data-zcc-theme>[\s\S]*<p>x<\/p>$/);
  });

  it('reads no tokens without a DOM', () => {
    expect(readThemeTokens(null)).toEqual({});
  });
});

describe('buildTree', () => {
  it('nests folders and sorts files before folders', () => {
    const tree = buildTree([{ path: 'diagrams/b.mmd' }, { path: 'README.md' }, { path: 'diagrams/a.mmd' }, { path: 'api.md' }]);
    expect(tree.map((node) => `${node.kind}:${node.path}`)).toEqual(['file:api.md', 'file:README.md', 'folder:diagrams']);
    const folder = tree[2]!;
    expect(folder.kind === 'folder' && folder.children.map((node) => node.name)).toEqual(['a.mmd', 'b.mmd']);
  });
});

describe('diff', () => {
  it('diffs only the changed middle and keeps context', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].join('\n');
    const after = ['a', 'b', 'c', 'd', 'E', 'f', 'g', 'h', 'i', 'j', 'k'].join('\n');
    const lines = lineDiff(before, after)!;
    expect(diffStats(lines)).toEqual({ added: 2, removed: 1 });
    const hunks = foldDiff(lines, 1);
    expect(hunks.map((hunk) => hunk.type)).toEqual(['gap', 'lines', 'gap', 'lines']);
    expect(hunks[0]).toEqual({ type: 'gap', count: 3 });
    expect(foldDiff(lineDiff('same', 'same')!)).toEqual([{ type: 'gap', count: 1 }]);
  });

  it('handles pure additions and removals', () => {
    expect(lineDiff('', 'x\ny')!.map((line) => line.type)).toEqual(['del', 'add', 'add']);
    expect(lineDiff('x\ny', 'y')!.map((line) => line.type)).toEqual(['del', 'same']);
    expect(lineDiff('a\nb\nc', 'a\nc\nb')!.filter((line) => line.type !== 'same')).toHaveLength(2);
  });

  it('gives up past the line budget', () => {
    expect(lineDiff('a\nb\nc', 'x\ny\nz', 2)).toBeNull();
  });
});

describe('small helpers', () => {
  it('picks the active file', () => {
    const doc = { entryPath: 'README.md', files: [{ path: 'api.md' }, { path: 'README.md' }] } as never;
    expect(resolveActivePath(doc, 'api.md')).toBe('api.md');
    expect(resolveActivePath(doc, 'gone.md')).toBe('README.md');
    expect(resolveActivePath({ entryPath: 'gone.md', files: [{ path: 'api.md' }] } as never, null)).toBe('api.md');
    expect(resolveActivePath({ entryPath: 'README.md', files: [] } as never, null)).toBeNull();
  });

  it('seeds new files by type and defaults to markdown', () => {
    expect(starterContent('notes/open_questions.md')).toBe('# Open questions\n\n');
    expect(starterContent('flow.mmd')).toContain('flowchart LR');
    expect(starterContent('mockups/login-page.html')).toContain('<title>Login page</title>');
    expect(starterContent('logo.svg')).toContain('<svg');
    expect(starterContent('main.ts')).toBe('');
    expect(withDefaultExtension(' /notes/plan ')).toBe('notes/plan.md');
    expect(withDefaultExtension('flow.mmd')).toBe('flow.mmd');
  });

  it('wraps a brief into a drafting prompt', () => {
    const prompt = draftingPrompt('  Sync offline edits  ');
    expect(prompt).toMatch(/^Draft this design doc/);
    expect(prompt.endsWith('Brief:\n\nSync offline edits')).toBe(true);
  });

  it('formats sizes and times', () => {
    expect(formatBytes(12)).toBe('12 B');
    expect(formatBytes(4096)).toBe('4 KiB');
    expect(formatBytes(3 * 1024 * 1024 + 200_000)).toBe('3.2 MiB');
    const now = Date.UTC(2026, 0, 31);
    expect(relativeTime(now - 10_000, now)).toBe('just now');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5m ago');
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2d ago');
    expect(relativeTime(Date.UTC(2025, 5, 1), now)).toBe('2025-06-01');
  });
});

describe('api client', () => {
  afterEach(() => {
    delete (globalThis as { __ZCC_PLUGIN_RUNTIME__?: unknown }).__ZCC_PLUGIN_RUNTIME__;
  });

  it('maps every method to its RPC with plain JSON arguments', async () => {
    const calls: Array<[string, unknown]> = [];
    const api = createApi(async (method, args) => {
      calls.push([method, args]);
      return { ok: true };
    });
    await api.templates();
    await api.projects();
    await api.list();
    await api.get('d');
    await api.create({ title: 'T', summary: undefined });
    await api.update('d', { title: 'U' });
    await expect(api.remove('d')).resolves.toBeUndefined();
    await api.readFile('d', 'a.md');
    await api.renderPage('d', { path: 'index.html', draft: undefined });
    await api.readPageFile('d', 'data.json');
    await api.pageLink('d', 'index.html');
    await expect(api.reportRender('d', { path: 'index.html', revision: 2, deps: [], missing: [], problems: [], unanchored: [] })).resolves.toBeUndefined();
    await api.writeFile('d', { path: 'a.md', content: 'x', baseRevision: 2 });
    await api.editFile('d', { path: 'a.md', edits: [{ oldText: 'a', newText: 'b' }] });
    await api.deleteFile('d', 'a.md');
    await api.renameFile('d', 'a.md', 'b.md');
    await api.history('d');
    await api.revision('d', 3);
    await api.restore('d', 3);
    await api.addComment('d', { body: 'hi' });
    await api.setCommentStatus('d', 'c', 'resolved');
    await api.deleteComment('d', 'c');
    await api.unlinkThread('d', 't');
    await api.askAgent('d', { action: 'review', path: null });
    expect(calls).toEqual([
      ['templates', undefined],
      ['projects', undefined],
      ['list', {}],
      ['get', { doc: 'd' }],
      ['create', { title: 'T' }],
      ['update', { doc: 'd', title: 'U' }],
      ['remove', { doc: 'd' }],
      ['readFile', { doc: 'd', path: 'a.md' }],
      ['renderPage', { doc: 'd', path: 'index.html' }],
      ['readPageFile', { doc: 'd', path: 'data.json' }],
      ['pageLink', { doc: 'd', path: 'index.html' }],
      ['reportRender', { doc: 'd', path: 'index.html', revision: 2, deps: [], missing: [], problems: [], unanchored: [] }],
      ['writeFile', { doc: 'd', path: 'a.md', content: 'x', baseRevision: 2 }],
      ['editFile', { doc: 'd', path: 'a.md', edits: [{ oldText: 'a', newText: 'b' }] }],
      ['deleteFile', { doc: 'd', path: 'a.md' }],
      ['renameFile', { doc: 'd', from: 'a.md', to: 'b.md' }],
      ['history', { doc: 'd' }],
      ['revision', { doc: 'd', id: 3 }],
      ['restore', { doc: 'd', id: 3 }],
      ['addComment', { doc: 'd', body: 'hi' }],
      ['setCommentStatus', { doc: 'd', id: 'c', status: 'resolved' }],
      ['deleteComment', { doc: 'd', id: 'c' }],
      ['unlinkThread', { doc: 'd', threadId: 't' }],
      ['askAgent', { doc: 'd', action: 'review' }]
    ]);
  });

  it('cleans transport prefixes and detects conflicts', () => {
    expect(errorMessage(new Error("Error invoking remote method 'x': Error: file changed since revision 2"))).toBe(
      'file changed since revision 2'
    );
    expect(errorMessage('plain')).toBe('plain');
    expect(isConflict(new Error('README.md changed since revision 3'))).toBe(true);
    expect(isConflict(new Error('not found'))).toBe(false);
  });

  it('toasts through the host runtime when present', () => {
    expect(() => toast('no runtime')).not.toThrow();
    const spy = vi.fn();
    (globalThis as { __ZCC_PLUGIN_RUNTIME__?: unknown }).__ZCC_PLUGIN_RUNTIME__ = { toast: spy };
    toast('hello');
    toast('bad', 'error');
    expect(spy.mock.calls).toEqual([
      ['hello', 'info'],
      ['bad', 'error']
    ]);
  });
});
