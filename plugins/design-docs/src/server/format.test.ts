import { describe, expect, it } from 'vitest';
import type { DesignDocDetail, DesignDocFile } from '../shared/contract.js';
import { actorLabel, formatBundle, formatHistory, relativeTime, summaryLine, truncate } from './format.js';

const user = { kind: 'user' as const, label: 'You', threadId: null };

function file(path: string, content: string): DesignDocFile {
  return {
    path,
    content,
    encoding: 'utf8',
    kind: 'markdown',
    size: content.length,
    revision: 1,
    updatedAt: 0,
    updatedBy: user
  };
}

const doc: DesignDocDetail = {
  id: 'dd_1',
  slug: 'doc',
  title: 'Doc',
  summary: '',
  status: 'draft',
  projectId: null,
  tags: [],
  entryPath: 'README.md',
  revision: 1,
  fileCount: 2,
  openComments: 0,
  createdAt: 0,
  updatedAt: 0,
  createdBy: user,
  updatedBy: user,
  files: [],
  comments: [],
  threads: []
};

describe('format', () => {
  it('renders relative times', () => {
    const now = Date.UTC(2026, 9, 7);
    expect(relativeTime(now - 10_000, now)).toBe('just now');
    expect(relativeTime(now + 10_000, now)).toBe('just now');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5m ago');
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(relativeTime(now - 4 * 86_400_000, now)).toBe('4d ago');
    expect(relativeTime(Date.UTC(2026, 0, 2), now)).toBe('2026-01-02');
  });

  it('labels actors and summarises docs', () => {
    expect(actorLabel(user)).toBe('You');
    expect(actorLabel({ kind: 'agent', label: 'Bot', threadId: 't' })).toBe('agent "Bot"');
    const line = summaryLine({ ...doc, fileCount: 1, openComments: 2, summary: 'A  long\nsummary' }, 0);
    expect(line).toBe('- dd_1 "Doc" (Draft · 1 file · 2 open comments · updated just now) — A long summary');
    expect(summaryLine({ ...doc, openComments: 1 }, 0)).toContain('1 open comment ·');
  });

  it('bundles the entry file first and lists what did not fit', () => {
    const files = [file('a.md', 'a'.repeat(800)), file('README.md', 'entry'), file('b.md', 'b')];
    const bundle = formatBundle(doc, files, { maxChars: 700, now: 0 });
    expect(bundle.indexOf('path="README.md"')).toBeLessThan(bundle.indexOf('path="b.md"'));
    expect(bundle).toContain('(1 file(s) omitted to stay within size limits — read them by path: a.md)');
    expect(formatBundle(doc, files, { now: 0 })).not.toContain('omitted');
  });

  it('formats history and truncates', () => {
    expect(formatHistory([])).toBe('No history.');
    expect(
      formatHistory(
        [
          {
            id: 7,
            path: 'b.md',
            revision: 3,
            op: 'rename',
            size: 10,
            note: null,
            renamedFrom: 'a.md',
            actor: user,
            createdAt: 0
          }
        ],
        0
      )
    ).toBe('- #7 rename b.md (from a.md) → rev 3, 10 B, You just now');
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('  a  b ', 10)).toBe('a b');
  });
});
