import { describe, expect, it } from 'vitest';
import { classifyMarkdownFileTarget } from './markdown-file-target.js';

describe('assistant Markdown file targets', () => {
  it.each([
    ['D:/repo/guide.md', 'D:/repo/guide.md', null],
    ['/D:/repo/guide.md', 'D:/repo/guide.md', null],
    ['d:\\Repo\\guide.md:12', 'd:/Repo/guide.md', 12],
    ['file:///D:/repo/a%20b.md#L2', 'D:/repo/a b.md', 2],
    ['/Users/Me/Guide.md:3', '/Users/Me/Guide.md', 3],
    ['file:///Users/Me/Guide.md#L4', '/Users/Me/Guide.md', 4],
    ['file://localhost/Users/Me/Guide.md', '/Users/Me/Guide.md', null],
    ['./docs/a%20b.md', './docs/a b.md', null],
    ['docs/שלום.md#L5', 'docs/שלום.md', 5],
    ['/Users/Me/name\\part.md', '/Users/Me/name\\part.md', null],
    ['/Users/Me/report:2026.md', '/Users/Me/report:2026.md', null],
    ['file:///Users/Me/report:2026.md', '/Users/Me/report:2026.md', null],
    ['/Users/Me/report.v1:2026.md', '/Users/Me/report.v1:2026.md', null],
    ['file:///Users/Me/report.v1:2026.md', '/Users/Me/report.v1:2026.md', null],
    ['file:///Users/Me/report.v1%3A2026.md', '/Users/Me/report.v1:2026.md', null],
    ['/Users/Me/report.v1:2026.md:7', '/Users/Me/report.v1:2026.md', 7],
    ['file:///Users/Me/report.v1:2026.md#L8', '/Users/Me/report.v1:2026.md', 8],
    ['/repo/file.abcdefghijkl', '/repo/file.abcdefghijkl', null],
    ['file.abcdefghijkl:7', 'file.abcdefghijkl', 7],
    ['/Users/Me/a..b.md', '/Users/Me/a..b.md', null],
    ['/Users/Me/a%2520b.md', '/Users/Me/a%20b.md', null],
    ['/Users/Me/100%25.md', '/Users/Me/100%.md', null],
    ['./docs/100%25.md', './docs/100%.md', null],
    ['guide.md:7', 'guide.md', 7],
    ['guide.md#L7', 'guide.md', 7],
    ['/Users/Me/guide.md#heading', '/Users/Me/guide.md', null],
    ['/Users/Me/guide.md#List', '/Users/Me/guide.md', null],
    ['file:///Users/Me/Makefile', '/Users/Me/Makefile', null]
  ])('normalizes %s without changing filesystem semantics', (href, path, lineNumber) => {
    expect(classifyMarkdownFileTarget(href)).toEqual({ kind: 'file', path, lineNumber });
  });

  it.each([
    'D:guide.md', '/D:guide.md', 'file://server/share/a.md', 'file:/Users/me/a.md',
    '/Users/me/../a.md', 'file:///Users/me/%2e%2e/a.md', 'file:///D:\\repo\\..\\a.md',
    '/Users/me/a%2fb.md', '/Users/me/a%5cb.md', '/Users/me/a%00b.md',
    '/Users/me/a%ZZ.md', '/Users/me/100%.md', './docs/100%.md', '/Users/me/a.md:0', '/Users/me/a.md:-2',
    '/Users/me/a.md:9007199254740992', '/Users/me/a.md#L0', '/Users/me/a.md#L12bad',
    '/Users/me/a.md:2#L3', '/Users/me/a.md?query=1', '/Users/me/a\nb.md'
  ])('reports invalid local target %s', (href) => {
    expect(classifyMarkdownFileTarget(href)).toMatchObject({ kind: 'invalid' });
  });

  it.each([
    undefined, '', '#heading', 'https://example.com/a.md', 'http://localhost:3000/',
    '//host/a.md', '//workspace/a.md', '//workspace/volumes/repo/guide.md', '//D:/repo/guide.md',
    '/repo/file.abcdefghijklm', 'file.abcdefghijklm:7', 'mailto:me@example.com', 'javascript:alert(1)',
    'data:text/html,test', 'blob:https://example.com/id', 'example.com', 'report.md',
    'www.github.io', '/threads/thread-1', 'zcc-thread:thread-1', 'custom:thing.md', 'guide.md#List'
  ])('preserves ordinary navigation classification for %s', (href) => {
    expect(classifyMarkdownFileTarget(href)).toBeNull();
  });
});
