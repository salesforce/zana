import { describe, expect, it } from 'vitest';
import { confinePathToRoot, threadPathApi } from './thread-path-confine.js';

describe('confinePathToRoot', () => {
  it('uses Windows path syntax for an authoritative Windows root on POSIX servers', () => {
    expect(confinePathToRoot('D:\\Work\\zana', 'D:\\Work\\zana\\docs\\guide.md'))
      .toBe('docs/guide.md');
  });

  it('uses POSIX path syntax for Linux roots and rejects escapes', () => {
    expect(confinePathToRoot('/work/zana', '/work/zana/docs/guide.md')).toBe('docs/guide.md');
    expect(confinePathToRoot('/work/zana', '../outside.md')).toBeNull();
  });

  it('selects path syntax from the registered root, independent of server OS', () => {
    expect(threadPathApi('D:\\Work\\repo').resolve('D:\\Work\\repo', 'docs\\guide.md'))
      .toBe('D:\\Work\\repo\\docs\\guide.md');
    expect(threadPathApi('/home/agent/repo').resolve('/home/agent/repo', 'docs/guide.md'))
      .toBe('/home/agent/repo/docs/guide.md');
  });

  it('rejects empty, NUL, relative-root, cross-platform and overlong paths', () => {
    expect(confinePathToRoot('', 'guide.md')).toBeNull();
    expect(confinePathToRoot('/work/repo', '')).toBeNull();
    expect(confinePathToRoot('/work/repo', 'bad\0name.md')).toBeNull();
    expect(confinePathToRoot('relative/repo', 'guide.md')).toBeNull();
    expect(confinePathToRoot('/work/repo', 'C:\\outside\\guide.md')).toBeNull();
    expect(confinePathToRoot('D:\\work\\repo', 'D:\\outside\\guide.md')).toBeNull();
    expect(confinePathToRoot('D:\\work\\repo', '/docs/guide.md')).toBeNull();
    expect(confinePathToRoot('D:\\work\\repo', 'D:docs/guide.md')).toBeNull();
    expect(confinePathToRoot('/work/repo', `docs/${'x'.repeat(1030)}.md`)).toBeNull();
  });

  it('normalizes relative and absolute in-root candidates for Windows and POSIX roots', () => {
    expect(confinePathToRoot('/work/repo', 'docs/../guide.md')).toBe('guide.md');
    expect(confinePathToRoot('D:\\work\\repo', 'D:\\work\\repo\\docs\\guide.md'))
      .toBe('docs/guide.md');
  });

  it('accepts Windows drive paths with equivalent slash styles', () => {
    expect(confinePathToRoot('D:\\work\\repo', 'D:/work/repo/docs/guide.md'))
      .toBe('docs/guide.md');
  });
});
