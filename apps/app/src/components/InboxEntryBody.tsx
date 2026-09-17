import { product } from '../lib/product-client.js';
import { useEffect, useState } from 'react';
import { Copy, Download, Loader2 } from 'lucide-react';
import type { InboxDoc, InboxEntry, Project } from '@zana-ai/zcc-domain/product';
import { useUi } from '../store.js';
import { inboxPrimaryTitle } from '../lib/inboxPresentation.js';
import { renderReportHtml, type ReportDoc as PdfReportDoc } from '../lib/renderReportHtml.js';
import { DocContent, MarkdownContent } from './MarkdownContent.js';

/** Cap on total source markdown re-read for a copy/PDF export; mirrors InboxDetail. */
const EXPORT_TOTAL_BYTES_CAP = 32 * 1024 * 1024; // 32 MB

/**
 * Compact inbox-entry viewer: live docs, comments, copy, and PDF export.
 * Shared by the agent-inspector Report stage and the thread side-panel Inbox tab.
 */
export function InboxEntryBody({ entry, project }: { entry: InboxEntry; project: Project | null }) {
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
        const r = await product.fs.readFile(joinPath(project.path, d.path));
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
      const result = await product.inbox.exportPdf({ html, suggestedName: title });
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

/** One report doc, fetched live via product.fs.readFile against the project root. */
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
    void product.fs.readFile(abs).then((r) => {
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
