import { describe, expect, it } from 'vitest';
import type { DesignDocComment, DesignDocDetail, DesignDocFile } from '../shared/contract.js';
import {
  actorLabel,
  commentLine,
  formatBundle,
  formatHistory,
  formatManifest,
  formatPageCheck,
  formatRenderReport,
  relativeTime,
  renderReportIssues,
  summaryLine,
  truncate
} from './format.js';
import type { RenderReport } from './render-reports.js';

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
    expect(actorLabel(user)).toBe('the user');
    expect(actorLabel({ kind: 'agent', label: 'Bot', threadId: 't' })).toBe('agent "Bot"');
    const line = summaryLine({ ...doc, fileCount: 1, openComments: 2, summary: 'A  long\nsummary' }, 0);
    expect(line).toBe('- dd_1 "Doc" (Draft · 1 file · 2 open comments · updated just now) — A long summary');
    expect(summaryLine({ ...doc, openComments: 1 }, 0)).toContain('1 open comment ·');
  });

  it('prints comment threads with their replies', () => {
    const agent = { kind: 'agent' as const, label: 'Bot', threadId: 't' };
    const line = commentLine(
      {
        id: 'c_1',
        docId: 'dd_1',
        path: 'README.md',
        quote: 'Use a queue',
        body: 'Why a queue?',
        author: user,
        status: 'resolved',
        createdAt: 0,
        resolvedAt: 0,
        replies: [{ id: 'c_2', body: 'Ordering.\nAnd retries.', author: agent, createdAt: 0 }]
      },
      0
    );
    expect(line.split('\n')).toEqual([
      '- [c_1] on README.md › "Use a queue" [resolved] the user, just now: Why a queue?',
      '  ↳ reply agent "Bot", just now: Ordering.',
      '    And retries.'
    ]);
  });

  it('names the project, or says the doc is global', () => {
    const detail = { ...doc, files: [], comments: [], threads: [] } as unknown as DesignDocDetail;
    expect(formatManifest(detail, { now: 0 })).toContain('project: global (all projects)');
    expect(formatManifest({ ...detail, projectId: 'p1' }, { now: 0 })).toContain('project: p1 ·');
    expect(formatManifest({ ...detail, projectId: 'p1' }, { now: 0, projectName: 'App' })).toContain('project: App ·');
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
    ).toBe('- #7 rename b.md (from a.md) → rev 3, 10 B, the user just now');
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('  a  b ', 10)).toBe('a b');
  });

  it('reports what a page check found', () => {
    expect(formatPageCheck({ path: 'index.html', missing: [], warnings: [] })).toBeNull();
    expect(formatPageCheck({ path: 'index.html', missing: ['app.js'], warnings: ['https://cdn.example/x.js is not loaded in previews.'] })).toBe(
      [
        'Page check for index.html:',
        '- Missing: the page uses app.js, which is not a file in this doc.',
        '- Blocked: https://cdn.example/x.js is not loaded in previews.'
      ].join('\n')
    );
  });

  it('reports what the panel saw when it ran a page', () => {
    const report: RenderReport = {
      docId: 'dd_1',
      path: 'index.html',
      revision: 3,
      deps: [],
      missing: [],
      problems: [
        { kind: 'error', message: 'x is not defined', source: 'app.js', line: 4 },
        { kind: 'blocked', message: 'The page tried to open a popup.', source: 'index.html' },
        { kind: 'missing', message: `data.json ${'is gone '.repeat(60)}` }
      ],
      unanchored: ['Pass rate', 'Closed quote'],
      at: 0
    };
    const comment = (id: string, patch: Partial<DesignDocComment>): DesignDocComment => ({
      id,
      docId: 'dd_1',
      path: 'index.html',
      quote: 'Pass rate',
      body: 'b',
      author: user,
      status: 'open',
      createdAt: 0,
      resolvedAt: null,
      replies: [],
      ...patch
    });
    const comments = [
      comment('c_1', {}),
      comment('c_2', { quote: 'Closed quote', status: 'resolved' }),
      comment('c_3', { path: 'other.html' }),
      comment('c_4', { quote: 'Shown fine' }),
      comment('c_5', { quote: null })
    ];
    const issues = renderReportIssues(report, comments);
    expect(issues.slice(0, 2)).toEqual(['- Error: x is not defined (app.js:4)', '- Blocked: The page tried to open a popup. (index.html)']);
    expect(issues[2]).toMatch(/^- Missing: data\.json is gone .*…$/);
    expect(issues[2]!.length).toBeLessThan(320);
    expect(issues[3]).toBe('- Comment c_1 quotes "Pass rate", which the page does not show.');
    expect(issues).toHaveLength(4);

    expect(formatRenderReport(report, comments, 0).split('\n')[0]).toBe('The Design Docs panel ran index.html (rev 3) just now:');
    expect(formatRenderReport({ ...report, problems: [], unanchored: [] }, comments, 0)).toBe(
      'The Design Docs panel ran index.html (rev 3) just now without problems.'
    );
  });
});
