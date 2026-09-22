import { useRef, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { product } from '../lib/product-client.js';
import { useUi } from '../store.js';

/** Export source content so long documents and unsaved edits are included. */
export function DocumentPdfButton({
  path,
  title,
  content,
  className = 'library-edit-btn'
}: {
  path: string;
  title: string;
  content: string | null;
  className?: string;
}) {
  const pushToast = useUi((s) => s.pushToast);
  const busy = useRef(false);
  const [exporting, setExporting] = useState(false);

  const download = async () => {
    if (content === null || busy.current) return;
    busy.current = true;
    setExporting(true);
    try {
      const { renderReportHtml } = await import('../lib/renderReportHtml.js');
      const html = await renderReportHtml({ title, docs: [{ path, content }] });
      const result = await product.inbox.exportPdf({ html, suggestedName: title });
      if (!result.ok) throw new Error(result.message || 'PDF export failed');
      pushToast(result.path ? `PDF saved to ${result.path}` : 'PDF saved', 'info');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'PDF export failed', 'error');
    } finally {
      busy.current = false;
      setExporting(false);
    }
  };

  return (
    <button
      type="button"
      className={className}
      onClick={() => void download()}
      disabled={content === null || exporting}
      aria-label="Download PDF"
      title="Download this document as PDF"
    >
      {exporting ? <Loader2 size={13} className="spin" aria-hidden /> : <Download size={13} aria-hidden />}
      <span>{exporting ? 'Exporting…' : 'Download PDF'}</span>
    </button>
  );
}
