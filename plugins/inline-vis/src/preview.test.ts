import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HEIGHT_PX,
  hostFileContentUrl,
  parsePreviewHeight,
  parsePreviewSource,
  previewContentUrl,
  previewKindForFile,
  renderSafeMarkdown,
  requirePreviewFile,
  requireWorkspaceHtmlFile
} from './preview.js';

function fakeReact() {
  return {
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children: children.flat() };
    }
  };
}

function collectTypes(node, acc = []) {
  if (!node || typeof node !== 'object') return acc;
  if (typeof node.type === 'string') acc.push(node.type);
  const kids = Array.isArray(node.children) ? node.children : [];
  for (const child of kids) collectTypes(child, acc);
  return acc;
}

describe('inline-vis preview helpers', () => {
  it('defaults and clamps height', () => {
    expect(parsePreviewHeight(undefined)).toBe(DEFAULT_HEIGHT_PX);
    expect(parsePreviewHeight('')).toBe(DEFAULT_HEIGHT_PX);
    expect(parsePreviewHeight('480')).toBe(480);
    expect(parsePreviewHeight('12')).toBeNull();
    expect(parsePreviewHeight('2000')).toBeNull();
    expect(parsePreviewHeight('tall')).toBeNull();
  });

  it('accepts workspace or thread-storage and rejects anything else', () => {
    expect(parsePreviewSource(undefined)).toBe('workspace');
    expect(parsePreviewSource('')).toBe('workspace');
    expect(parsePreviewSource('thread-storage')).toBe('thread-storage');
    expect(parsePreviewSource('s3')).toBeNull();
  });

  it('accepts confined html and markdown paths only', () => {
    expect(requirePreviewFile('charts/out.html')).toBe('charts/out.html');
    expect(requirePreviewFile('demo.HTM')).toBe('demo.HTM');
    expect(requirePreviewFile('notes.md')).toBe('notes.md');
    expect(requirePreviewFile('notes.markdown')).toBe('notes.markdown');
    expect(requirePreviewFile('../out.html')).toBeNull();
    expect(requirePreviewFile('/tmp/out.html')).toBeNull();
    expect(requirePreviewFile('charts/out.txt')).toBeNull();
    expect(requirePreviewFile('')).toBeNull();
    expect(requireWorkspaceHtmlFile('notes.md')).toBeNull();
    expect(requireWorkspaceHtmlFile('charts/out.html')).toBe('charts/out.html');
    expect(previewKindForFile('notes.md')).toBe('markdown');
    expect(previewKindForFile('demo.htm')).toBe('html');
  });

  it('builds confined content URLs for each source', () => {
    expect(hostFileContentUrl('thr_1', 'charts/out.html')).toBe(
      '/api/v1/threads/thr_1/host-files/content?path=charts%2Fout.html'
    );
    expect(previewContentUrl('thr_1', 'notes.md', 'thread-storage')).toBe(
      '/api/v1/threads/thr_1/thread-storage/content?path=notes.md'
    );
  });

  it('renders markdown as React elements and keeps HTML tags as text', () => {
    const tree = renderSafeMarkdown(
      fakeReact(),
      '# Title\n\nHello **world** and [link](https://example.com).\n\n- one\n\n```\nnoop()\n```\n\n<div>nope</div>'
    );
    const types = collectTypes(tree);
    expect(types).toContain('h1');
    expect(types).toContain('strong');
    expect(types).toContain('a');
    expect(types).toContain('ul');
    expect(types).toContain('pre');
    expect(types).toContain('p');
    const dumped = JSON.stringify(tree);
    expect(dumped).toContain('https://example.com');
    expect(dumped).toContain('<div>nope</div>');
    expect(JSON.stringify(tree.props)).not.toMatch(/innerHTML/);
  });
});
