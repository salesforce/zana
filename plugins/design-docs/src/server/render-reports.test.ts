import { describe, expect, it } from 'vitest';
import type { DesignDocFileMeta } from '../shared/contract.js';
import { MAX_PAGE_PROBLEMS } from '../shared/frame-protocol.js';
import { MAX_FILES_PER_DOC } from '../shared/limits.js';
import { MAX_RENDER_REPORT_CHARS, parseRenderReport, RenderReports } from './render-reports.js';

const REPORT = {
  path: 'index.html',
  revision: 2,
  deps: [{ path: 'site.css', revision: 1 }],
  missing: ['gone.js'],
  problems: [{ kind: 'error', message: 'x is not defined', source: 'index.html (inline script 1)', line: 3 }],
  unanchored: ['Pass rate']
};

const files = (...entries: Array<[string, number]>) => entries.map(([path, revision]) => ({ path, revision }) as DesignDocFileMeta);

describe('parseRenderReport', () => {
  it('keeps a well-formed report', () => {
    expect(parseRenderReport({ doc: 'd', ...REPORT, path: './index.html' })).toEqual(REPORT);
  });

  it('rejects anything malformed', () => {
    const bad = (patch: Record<string, unknown>, message: RegExp) => expect(() => parseRenderReport({ ...REPORT, ...patch })).toThrow(message);
    bad({ path: 1 }, /path must be a doc path/);
    bad({ path: '../up.html' }, /\.\./);
    bad({ revision: 0 }, /revision must be a saved revision/);
    bad({ revision: 1.5 }, /revision must be a saved revision/);
    bad({ revision: '2' }, /revision must be a saved revision/);
    bad({ deps: 'site.css' }, /deps must be an array/);
    bad({ deps: [null] }, /deps\[0\] needs a revision/);
    bad({ deps: [{ path: 'a', revision: -1 }] }, /deps\[0\] needs a revision/);
    bad({ deps: [{ path: 7, revision: 1 }] }, /deps\[0\]\.path must be a doc path/);
    bad({ deps: Array.from({ length: MAX_FILES_PER_DOC + 1 }, (_, index) => ({ path: `${index}`, revision: 1 })) }, /more than 500/);
    bad({ missing: ['x'.repeat(1001)] }, /missing\[0\] must be a doc path/);
    bad({ problems: [{ kind: 'weird', message: 'x' }] }, /problems\[0\] is not a page problem/);
    bad({ problems: Array.from({ length: MAX_PAGE_PROBLEMS + 1 }, () => REPORT.problems[0]) }, /more than 50/);
    bad({ unanchored: [3] }, /unanchored\[0\] must be a quote/);
    bad({ unanchored: ['x'.repeat(MAX_RENDER_REPORT_CHARS)] }, /too large/);
  });

  it('keeps at most 50 unanchored quotes', () => {
    const quotes = Array.from({ length: 80 }, (_, index) => `quote ${index}`);
    expect(parseRenderReport({ ...REPORT, unanchored: quotes }).unanchored).toEqual(quotes.slice(0, 50));
  });
});

describe('RenderReports', () => {
  it('answers with the reports that still match the doc, by path', () => {
    let now = 1000;
    const reports = new RenderReports(10, () => now);
    reports.record('d', { ...REPORT, path: 'b.html', deps: [], missing: [] });
    reports.record('d', REPORT);
    reports.record('other', REPORT);
    const doc = files(['index.html', 2], ['b.html', 2], ['site.css', 1]);
    expect(reports.current('d', doc).map((report) => [report.path, report.docId, report.at])).toEqual([
      ['b.html', 'd', 1000],
      ['index.html', 'd', 1000]
    ]);

    // A newer report replaces the old one.
    now = 2000;
    reports.record('d', { ...REPORT, problems: [] });
    expect(reports.current('d', doc).find((report) => report.path === 'index.html')).toMatchObject({ at: 2000, problems: [] });
  });

  it('drops reports the doc has moved past', () => {
    const reports = new RenderReports();
    const record = () => reports.record('d', REPORT);
    record();
    expect(reports.current('d', files(['index.html', 3], ['site.css', 1]))).toEqual([]);
    // Dropped, not hidden: the old revision coming back does not revive it.
    expect(reports.current('d', files(['index.html', 2], ['site.css', 1]))).toEqual([]);
    record();
    expect(reports.current('d', files(['index.html', 2], ['site.css', 2]))).toEqual([]);
    record();
    expect(reports.current('d', files(['index.html', 2], ['site.css', 1], ['gone.js', 1]))).toEqual([]);
    record();
    expect(reports.current('d', files(['site.css', 1]))).toEqual([]);
  });

  it('forgets the oldest report past its cap', () => {
    const reports = new RenderReports(2);
    for (const path of ['a.html', 'b.html', 'c.html']) reports.record('d', { ...REPORT, path, deps: [], missing: [] });
    const doc = files(['a.html', 2], ['b.html', 2], ['c.html', 2]);
    expect(reports.current('d', doc).map((report) => report.path)).toEqual(['b.html', 'c.html']);
    // Recording again counts as recent.
    reports.record('d', { ...REPORT, path: 'b.html', deps: [], missing: [] });
    reports.record('d', { ...REPORT, path: 'a.html', deps: [], missing: [] });
    expect(reports.current('d', doc).map((report) => report.path)).toEqual(['a.html', 'b.html']);
  });
});
