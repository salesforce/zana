import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Copy, Download, FileText, Loader2 } from 'lucide-react';
import type { InboxDoc, InboxEntry, Project } from '@shared/types';
import { useInbox, useUi } from '../store';
import { isReport } from '../util/feedCategories';
import { inboxPrimaryTitle } from '../util/inboxPresentation';
import { renderReportHtml, type ReportDoc as PdfReportDoc } from '../util/renderReportHtml';
import { DocContent, MarkdownContent } from './MarkdownContent';

/**
 * The "Report" stage of the agent-inspector modal: the reports this agent has
 * pushed to the inbox (`inbox_push({ report: true })`) via the session-scoped
 * MCP route, which stamps `InboxEntry.sessionId` — the same linkage
 * {@link ModalPendingQuestion} in AgentTerminalModal already relies on. A list
 * on entry; clicking a report shows its rendered markdown (docs, then
 * comments) with a back arrow to return to the list. Renders an empty state
 * when the agent hasn't pushed a flagged report yet.
 */
export function AgentReportPanel({
  sessionId,
  project
}: {
  sessionId: string;
  project: Project | null;
}) {
  const entries = useInbox((s) => s.entries);
  const reports = useMemo(
    () => entries.filter((e) => e.sessionId === sessionId && isReport(e)),
    [entries, sessionId]
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Keep selection valid as the live list changes underneath (a coalesced
  // entry refreshing in place, or the list shrinking).
  useEffect(() => {
    if (selectedId && !reports.some((r) => r.id === selectedId)) setSelectedId(null);
  }, [reports, selectedId]);

  const selected = selectedId ? reports.find((r) => r.id === selectedId) ?? null : null;

  if (reports.length === 0) {
    return (
      <div className="agent-report-empty">
        <FileText size={22} strokeWidth={1.5} aria-hidden />
        <p>No reports yet. Reports the agent pushes to the inbox will show up here.</p>
      </div>
    );
  }

  if (selected) {
    return (
      <div className="agent-report-detail">
        <button
          type="button"
          className="agent-report-back"
          onClick={() => setSelectedId(null)}
        >
          <ArrowLeft size={13} /> All reports
        </button>
        <ReportBody entry={selected} project={project} />
      </div>
    );
  }

  return (
    <div className="agent-report-list" role="list">
      {reports.map((entry) => (
        <button
          key={entry.id}
          type="button"
          role="listitem"
          className="agent-report-row"
          onClick={() => setSelectedId(entry.id)}
        >
          <FileText size={14} strokeWidth={1.75} className="agent-report-row-icon" aria-hidden />
          <span className="agent-report-row-title">{inboxPrimaryTitle(entry)}</span>
          <span className="agent-report-row-ts">{formatReportTime(entry.ts)}</span>
        </button>
      ))}
    </div>
  );
}

/** Cap on total source markdown re-read for a copy/PDF export; mirrors InboxDetail. */
const EXPORT_TOTAL_BYTES_CAP = 32 * 1024 * 1024; // 32 MB

/** The selected report's content: its docs (fetched live), then its comments. */
function ReportBody({ entry, project }: { entry: InboxEntry; project: Project | null }) {
  const hasDocs = (entry.docs?.length ?? 0) > 0;
  const hasComments = (entry.comments ?? '').trim().length > 0;
  const canExport = hasDocs || hasComments;
  const pushToast = useUi((s) => s.pushToast);
  const title = inboxPrimaryTitle(entry);
  const [exporting, setExporting] = useState(false);
  const [copying, setCopying] = useState(false);

  // Re-read each doc fresh (like InboxDetail's exportPdf/onSave) rather than
  // relying on ReportDoc's per-doc state, so copy/export work independent of
  // what's currently mounted/loaded on screen.
  const readDocs = async (): Promise<PdfReportDoc[]> => {
    const docs: PdfReportDoc[] = [];
    let totalBytes = 0;
    for (const d of entry.docs ?? []) {
      if (!project) {
        docs.push({ path: d.path, error: 'Project no longer exists' });
        continue;
      }
      if (totalBytes >= EXPORT_TOTAL_BYTES_CAP) {
        docs.push({ path: d.path, error: 'Skipped: export size limit reached' });
        continue;
      }
      try {
        const r = await window.cc.fs.readFile(joinPath(project.path, d.path));
        if (r.ok && typeof r.content === 'string') {
          totalBytes += r.content.length;
          docs.push({ path: d.path, content: r.content });
        } else {
          docs.push({ path: d.path, error: 'File could not be read.' });
        }
      } catch (e) {
        docs.push({ path: d.path, error: e instanceof Error ? e.message : 'Read failed' });
      }
    }
    return docs;
  };

  const onCopy = async () => {
    if (copying) return;
    setCopying(true);
    try {
      const docs = await readDocs();
      const parts = docs.map((d) => d.content ?? `_${d.error ?? 'File could not be read.'}_`);
      if (hasComments) parts.push(entry.comments!);
      await navigator.clipboard.writeText(parts.join('\n\n---\n\n'));
      pushToast('Report copied', 'info');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Failed to copy', 'error');
    } finally {
      setCopying(false);
    }
  };

  const onDownload = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const docs = await readDocs();
      const html = await renderReportHtml({ title, docs, comments: entry.comments });
      const result = await window.cc.inbox.exportPdf({ html, suggestedName: title });
      if (result.ok) {
        pushToast(result.path ? `PDF saved to ${result.path}` : 'PDF saved', 'info');
      } else if (result.message) {
        pushToast(result.message, 'error');
      }
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'PDF export failed', 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="agent-report-body">
      <div className="agent-report-header">
        <h3 className="agent-report-title">{title}</h3>
        {canExport && (
          <div className="agent-report-actions">
            <button
              type="button"
              onClick={() => void onCopy()}
              className="inbox-detail-download"
              disabled={copying}
              title="Copy report to clipboard"
              aria-label="Copy report to clipboard"
            >
              <Copy size={14} strokeWidth={1.75} />
            </button>
            <button
              type="button"
              onClick={() => void onDownload()}
              className="inbox-detail-download"
              disabled={exporting}
              title="Download as PDF"
              aria-label="Download this report as PDF"
            >
              <Download size={14} strokeWidth={1.75} />
            </button>
          </div>
        )}
      </div>
      {hasComments && (
        <div className="agent-report-comments">
          <MarkdownContent text={entry.comments!} exportable />
        </div>
      )}
      {hasDocs && (
        <div className={`agent-report-docs ${hasComments ? 'has-divider' : ''}`}>
          {entry.docs!.map((doc) => (
            <ReportDoc key={doc.path} doc={doc} project={project} />
          ))}
        </div>
      )}
    </div>
  );
}

/** One report doc, fetched live via window.cc.fs.readFile against the project root. */
function ReportDoc({ doc, project }: { doc: InboxDoc; project: Project | null }) {
  const [content, setContent] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setContent(undefined);
    if (!project) {
      setContent(null);
      return;
    }
    const abs = joinPath(project.path, doc.path);
    void window.cc.fs.readFile(abs).then((r) => {
      if (cancelled) return;
      setContent(r.ok && typeof r.content === 'string' ? r.content : null);
    });
    return () => {
      cancelled = true;
    };
  }, [project, doc.path]);

  return (
    <div className="agent-report-doc">
      <div className="agent-report-doc-path" title={doc.path}>
        {doc.path}
      </div>
      {content === undefined ? (
        <div className="agent-report-doc-loading">
          <Loader2 size={13} className="spin" /> Loading…
        </div>
      ) : content === null ? (
        <div className="agent-report-doc-missing">File could not be read.</div>
      ) : (
        <DocContent path={doc.path} content={content} exportable />
      )}
    </div>
  );
}

function joinPath(root: string, rel: string): string {
  const cleanRel = rel.replace(/^[/\\]+/, '');
  if (root.endsWith('/') || root.endsWith('\\')) return root + cleanRel;
  return `${root}/${cleanRel}`;
}

function formatReportTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}
