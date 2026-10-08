/**
 * What the panel saw the last time it ran each saved page: the page's own
 * problems (script errors, blocked actions) and the open comments whose quote
 * it did not show. Agents read these through `design_doc_read`, since a page's
 * scripts only ever run in a browser. Kept in memory and bounded; a report
 * counts only while the doc still matches the render it came from.
 */
import type { DesignDocFileMeta } from '../shared/contract.js';
import { MAX_PAGE_PROBLEMS, parsePageProblem } from '../shared/frame-protocol.js';
import { MAX_FILES_PER_DOC, MAX_QUOTE_LENGTH } from '../shared/limits.js';
import { renderIsStale, type PageRenderReport } from '../shared/page.js';
import { normalizeDocPath } from '../shared/paths.js';
import { DesignDocError } from './store.js';

export const MAX_RENDER_REPORTS = 100;
/** One report, as JSON; a page that reads every file of a full doc stays well under. */
export const MAX_RENDER_REPORT_CHARS = 128 * 1024;
const MAX_UNANCHORED = 50;
const MAX_PATH_CHARS = 1_000;

export interface RenderReport extends PageRenderReport {
  docId: string;
  at: number;
}

function invalid(message: string): never {
  throw new DesignDocError('invalid', message);
}

function list<T>(value: unknown, name: string, max: number, item: (entry: unknown, index: number) => T): T[] {
  if (!Array.isArray(value)) invalid(`${name} must be an array`);
  if (value.length > max) invalid(`${name} has more than ${max} entries`);
  return value.map(item);
}

function pathText(value: unknown, name: string): string {
  return typeof value === 'string' && value.length <= MAX_PATH_CHARS ? value : invalid(`${name} must be a doc path`);
}

/** A report from the panel, checked and bounded. */
export function parseRenderReport(input: Record<string, unknown>): PageRenderReport {
  if (JSON.stringify(input).length > MAX_RENDER_REPORT_CHARS) invalid('render report is too large');
  let path: string;
  try {
    path = normalizeDocPath(pathText(input.path, 'path'));
  } catch (error) {
    invalid((error as Error).message);
  }
  const revision = input.revision;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1) invalid('revision must be a saved revision');
  return {
    path,
    revision,
    deps: list(input.deps, 'deps', MAX_FILES_PER_DOC, (entry, index) => {
      const dep = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
      const depRevision = dep.revision;
      if (typeof depRevision !== 'number' || !Number.isSafeInteger(depRevision) || depRevision < 0) invalid(`deps[${index}] needs a revision`);
      return { path: pathText(dep.path, `deps[${index}].path`), revision: depRevision };
    }),
    missing: list(input.missing, 'missing', MAX_FILES_PER_DOC, (entry, index) => pathText(entry, `missing[${index}]`)),
    problems: list(input.problems, 'problems', MAX_PAGE_PROBLEMS, (entry, index) => parsePageProblem(entry) ?? invalid(`problems[${index}] is not a page problem`)),
    unanchored: list(input.unanchored, 'unanchored', MAX_FILES_PER_DOC, (entry, index) =>
      typeof entry === 'string' && entry.length <= MAX_QUOTE_LENGTH ? entry : invalid(`unanchored[${index}] must be a quote`)
    ).slice(0, MAX_UNANCHORED)
  };
}

export class RenderReports {
  private readonly reports = new Map<string, RenderReport>();

  constructor(
    private readonly max = MAX_RENDER_REPORTS,
    private readonly now: () => number = Date.now
  ) {}

  record(docId: string, report: PageRenderReport): void {
    const key = `${docId}\u0000${report.path}`;
    this.reports.delete(key);
    this.reports.set(key, { ...report, docId, at: this.now() });
    while (this.reports.size > this.max) this.reports.delete(this.reports.keys().next().value as string);
  }

  /** The doc's reports that still describe it, by path; stale ones are dropped. */
  current(docId: string, files: readonly DesignDocFileMeta[]): RenderReport[] {
    const found: RenderReport[] = [];
    for (const [key, report] of this.reports) {
      if (report.docId !== docId) continue;
      if (renderIsStale(report, files, false)) this.reports.delete(key);
      else found.push(report);
    }
    return found.sort((a, b) => a.path.localeCompare(b.path));
  }
}
