import { createRoot } from 'react-dom/client';
import { DocContent, MarkdownContent } from '../components/MarkdownContent';
import { buildStandaloneHtml } from './exportHtml';

/**
 * Render an inbox entry's *source* content to standalone PDF HTML.
 *
 * Unlike the screen-snapshot path, this does NOT clone the live panel — it
 * mounts the docs + comments into a detached, off-screen React root using the
 * shared {@link MarkdownContent}/{@link DocContent} renderer, waits for the
 * async bits (mermaid → SVG) to settle, then serializes that clean subtree.
 *
 * Why a real mount and not renderToString: mermaid renders asynchronously in a
 * useEffect and needs a live DOM, so static string rendering would emit
 * "Rendering diagram…" placeholders. We mount, poll until no placeholders
 * remain (bounded), snapshot, then unmount.
 *
 * The container is positioned far off-screen rather than `display:none` so
 * layout/measurement (mermaid sizing, code wrapping) actually runs.
 */

export interface ReportDoc {
  /** Project-relative path; drives the .md vs source-file rendering branch. */
  path: string;
  /** Raw file content, or undefined if the read failed. */
  content?: string;
  /** Human-readable reason the content is missing (too large, binary, gone). */
  error?: string;
}

export interface ReportInput {
  /** Heading + <title> for the document. */
  title: string;
  docs: ReportDoc[];
  /** Trailing comments block (markdown), if any. */
  comments?: string;
}

/** Max time to wait for mermaid diagrams to finish before snapshotting. */
const MERMAID_SETTLE_TIMEOUT_MS = 8000;
const MERMAID_POLL_MS = 50;

export async function renderReportHtml(input: ReportInput): Promise<string> {
  const host = document.createElement('div');
  // Off-screen but laid out: keep a realistic content width so code blocks and
  // tables wrap the same way they will in the PDF (A4 ≈ 794px minus margins).
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText =
    'position:fixed;left:-10000px;top:0;width:794px;pointer-events:none;';
  document.body.appendChild(host);
  // Note: the LIGHT document palette is applied on the *export* <html> in
  // buildStandaloneHtml (the `var(--*)` tokens key off `:root[data-theme]`, so
  // they only resolve in the final standalone doc — not on this off-screen
  // host). This live render is used only for layout measurement (color-
  // independent) and to generate mermaid SVG, which gets its theme via the
  // mermaidTheme prop below — mermaid bakes colors into the SVG at render time,
  // so it can't be re-themed by the export stylesheet afterwards.

  const root = createRoot(host);
  try {
    root.render(<ReportBody {...input} />);

    // How many ```mermaid fences the source contains — i.e. how many diagrams
    // we must wait to SETTLE before snapshotting. Counting the EXPECTED total
    // (rather than polling for "no loading node") is what closes the startup
    // race: createRoot commits asynchronously, so an immediate "nothing
    // pending" check passes before any diagram has even mounted, and the
    // snapshot then captures the "Rendering diagram…" placeholder.
    const expected = countMermaidFences(input);
    await waitForMermaid(host, expected);

    const exportRoot = host.querySelector<HTMLElement>('.pdf-report');
    return buildStandaloneHtml(exportRoot ?? host, input.title);
  } finally {
    root.unmount();
    host.remove();
  }
}

/**
 * Count ` ```mermaid ` fenced code blocks across all doc bodies + comments. This
 * is the number of {@link MermaidDiagram}s {@link ReportBody} will mount, which
 * {@link waitForMermaid} uses as the target settle count. A small over- or
 * under-count only changes timing (the deadline still bounds the wait), never
 * correctness, so a cheap fence regex is enough — we don't parse markdown here.
 */
export function countMermaidFences(input: ReportInput): number {
  const sources = [
    ...input.docs.map((d) => (d.path.endsWith('.md') ? d.content ?? '' : '')),
    input.comments ?? ''
  ];
  // Opening fence of a mermaid block: ``` (or more) + optional space + "mermaid"
  // at a line start. Matches the language detection MarkdownContent relies on.
  const fence = /^[ \t]*`{3,}[ \t]*mermaid\b/gim;
  return sources.reduce((n, src) => n + (src.match(fence)?.length ?? 0), 0);
}

/**
 * Resolve once every mounted MermaidDiagram has SETTLED — rendered its SVG or
 * fallen back to raw source — or the timeout elapses. Diagrams emit
 * `data-mermaid` on mount (any state) and flip `data-mermaid-state` to
 * `"settled"` when done; we wait until the diagrams have mounted and none are
 * still loading.
 *
 * `expected` (the source fence count) distinguishes "no diagrams → return
 * immediately" from "some diagrams → must wait for them to mount". It does NOT
 * need to be exact: React's `createRoot` commits all placeholders in a single
 * synchronous batch, so once ANY diagram has mounted the mount count is final —
 * we then wait for that final set to settle regardless of a fence over/under-
 * count. The deadline bounds a stuck diagram (no worse than prior behaviour).
 */
function waitForMermaid(host: HTMLElement, expected: number): Promise<void> {
  const settleAfterLayout = (resolve: () => void) => {
    // One more frame so just-injected SVG is laid out before the snapshot.
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  };

  if (expected <= 0) {
    return new Promise((resolve) => settleAfterLayout(resolve));
  }

  const deadline = performance.now() + MERMAID_SETTLE_TIMEOUT_MS;
  return new Promise((resolve) => {
    const tick = () => {
      const mounted = host.querySelectorAll('[data-mermaid]').length;
      const loading = host.querySelectorAll('[data-mermaid-state="loading"]').length;
      // Done when diagrams have mounted and none are still loading (every
      // mounted one settled), or the deadline passed. The `mounted > 0` guard is
      // what defeats the startup race: before React commits, mounted is 0 and
      // loading is 0, which must NOT count as done.
      const mountedAndAllSettled = mounted > 0 && loading === 0;
      if (mountedAndAllSettled || performance.now() >= deadline) {
        settleAfterLayout(resolve);
        return;
      }
      setTimeout(tick, MERMAID_POLL_MS);
    };
    tick();
  });
}

function ReportBody({ title, docs, comments }: ReportInput) {
  const hasComments = (comments ?? '').trim().length > 0;
  // Show a per-doc filename caption only when there's more than one doc — for a
  // single doc the title already identifies it and a path line is just noise.
  const showDocNames = docs.length > 1;
  return (
    <div className="pdf-report">
      <h1 className="pdf-report-title">{title}</h1>
      {docs.length > 0 && (
        <div className="pdf-report-docs">
          {docs.map((doc) => (
            <section className="pdf-report-doc" key={doc.path}>
              {showDocNames && <h2 className="pdf-report-doc-name">{doc.path}</h2>}
              {typeof doc.content === 'string' ? (
                <DocContent path={doc.path} content={doc.content} mermaidTheme="default" />
              ) : (
                <div className="pdf-report-tombstone">
                  {doc.error ?? 'File could not be read.'}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
      {hasComments && (
        <div className={`pdf-report-comments ${docs.length ? 'has-divider' : ''}`}>
          <div className="pdf-report-section-label">Comments</div>
          <MarkdownContent text={comments!} mermaidTheme="default" />
        </div>
      )}
    </div>
  );
}
