import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Code2, Download, FileImage } from 'lucide-react';
import { rasterizeSvgString, downloadBlob } from '../util/mermaidExport';

/**
 * Render a single mermaid code block to inline SVG.
 *
 * mermaid is heavy (~500KB) and only needed when a markdown body actually
 * contains a ```mermaid fence, so it's lazy-loaded on first render via a
 * dynamic import — the chunk never enters the main bundle for users who
 * never open a diagram.
 *
 * On a parse/render error we fall back to showing the raw source in a
 * <pre>, matching how the block would have looked before mermaid support —
 * a malformed diagram is no worse than the prior behaviour, never a blank.
 */

// Module-level singleton: load the mermaid module exactly once across all
// diagrams, and reuse the resolved module for every subsequent render.
let mermaidPromise: Promise<typeof import('mermaid').default> | null = null;

/** Mermaid's theme name for a given app/export theme. */
type MermaidTheme = 'dark' | 'default';

function currentTheme(): MermaidTheme {
  return document.documentElement.getAttribute('data-theme') === 'light'
    ? 'default'
    : 'dark';
}

async function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => m.default);
  }
  return mermaidPromise;
}

// Monotonic id source — mermaid.render requires a unique DOM id per call.
let renderSeq = 0;

/**
 * Render to SVG with an explicit theme. mermaid keeps a single global config,
 * so we (re-)initialize right before each render — it's cheap and idempotent,
 * and crucially it lets the PDF export force the light ('default') theme even
 * though a prior diagram in the same session may have initialized it dark.
 * That singleton-vs-export-theme trap is exactly why theme is per-render here.
 */
async function renderToSvg(theme: MermaidTheme, id: string, code: string): Promise<string> {
  const mermaid = await loadMermaid();
  mermaid.initialize({
    startOnLoad: false,
    theme,
    securityLevel: 'strict',
    fontFamily: 'inherit'
  });
  const { svg } = await mermaid.render(id, code);
  return svg;
}

/**
 * Render a *self-contained* SVG for export (copy-SVG + PNG/JPEG raster).
 *
 * Differs from {@link renderToSvg} in two ways that matter only off-screen:
 *  - `htmlLabels: false` forces native SVG <text> labels instead of the default
 *    <foreignObject> HTML labels. A canvas is TAINTED the instant you drawImage
 *    an <img> holding a foreignObject, so the on-screen SVG can't be rastered —
 *    toBlob would yield a blank (background-only) image. Native <text> keeps the
 *    SVG pure and rasterizable.
 *  - a concrete `fontFamily` (not 'inherit') so the standalone markup doesn't
 *    fall back to a serif default once it leaves the document.
 *
 * The on-screen diagram is untouched — this is a second, throwaway render.
 */
async function renderExportSvg(theme: MermaidTheme, id: string, code: string): Promise<string> {
  const mermaid = await loadMermaid();
  mermaid.initialize({
    startOnLoad: false,
    theme,
    securityLevel: 'strict',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    htmlLabels: false,
    flowchart: { htmlLabels: false }
  });
  const { svg } = await mermaid.render(id, code);
  return svg;
}

/**
 * @param theme  Override the diagram theme. Omitted ⇒ follow the live app
 *   theme (the on-screen behaviour). The PDF export passes 'default' so
 *   diagrams come out light regardless of the app's current dark theme.
 * @param exportable  Mount the hover toolbar (copy source/SVG, download
 *   PNG/JPEG). Off by default so the headless PDF-export path — which counts
 *   `data-mermaid-state` nodes — renders exactly as before, with no toolbar
 *   in the snapshot.
 */
export function MermaidDiagram({
  code,
  theme,
  exportable = false
}: {
  code: string;
  theme?: MermaidTheme;
  exportable?: boolean;
}) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState(false);
  // Toolbar "Source" toggle: swap the rendered diagram for its raw mermaid
  // code block in place. Only reachable via the exportable toolbar.
  const [showSource, setShowSource] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setError(false);

    void (async () => {
      try {
        const id = `inbox-mermaid-${renderSeq++}`;
        const rendered = await renderToSvg(theme ?? currentTheme(), id, code);
        if (!cancelled) setSvg(rendered);
      } catch {
        if (!cancelled) setError(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, theme]);

  // `data-mermaid` marks every mounted diagram (any state); `data-mermaid-state`
  // distinguishes a still-rendering one from a settled (svg/error) one. The PDF
  // export counts these to know when ALL expected diagrams have finished — a
  // plain "no loading node visible" check can't tell "done" from "not yet
  // mounted" and would snapshot the placeholder. See renderReportHtml.
  if (error) {
    return (
      <pre className="inbox-md-code" data-mermaid="1" data-mermaid-state="settled">
        {code}
      </pre>
    );
  }
  if (svg === null) {
    return (
      <div className="inbox-mermaid-loading" data-mermaid="1" data-mermaid-state="loading">
        Rendering diagram…
      </div>
    );
  }
  return (
    <div ref={containerRef} className="inbox-mermaid" data-mermaid="1" data-mermaid-state="settled">
      {exportable && (
        <MermaidToolbar
          code={code}
          theme={theme ?? currentTheme()}
          showSource={showSource}
          onToggleSource={() => setShowSource((s) => !s)}
        />
      )}
      {showSource ? (
        // "Source" toggled on: show the raw mermaid instead of the diagram.
        <pre className="inbox-md-code inbox-mermaid-source">{code}</pre>
      ) : (
        // mermaid output is its own trusted SVG (securityLevel 'strict'
        // sanitizes the diagram source); inject it as markup.
        <div dangerouslySetInnerHTML={{ __html: svg }} />
      )}
    </div>
  );
}

/** Solid background for a rastered export, matched to the diagram's theme. */
function exportBackground(theme: MermaidTheme): string {
  return theme === 'default' ? '#ffffff' : '#0d1117';
}

/**
 * Hover toolbar for a rendered diagram:
 *  - **Source** — a toggle (owned by the parent) that swaps the rendered
 *    diagram for its raw mermaid code block in place, and back.
 *  - **SVG** — copies the standalone SVG markup to the clipboard.
 *  - **Download ▾** — a dropdown offering PNG / JPEG raster export.
 *
 * Every image action re-renders the diagram to a self-contained SVG via
 * {@link renderExportSvg} (native <text> labels, concrete font) rather than
 * reading the on-screen node — the on-screen SVG uses <foreignObject> HTML
 * labels, which taint the export canvas and yield a blank raster. The export
 * SVG is rendered once, lazily, and cached for reuse.
 */
function MermaidToolbar({
  code,
  theme,
  showSource,
  onToggleSource
}: {
  code: string;
  theme: MermaidTheme;
  showSource: boolean;
  onToggleSource: () => void;
}) {
  const [copiedSvg, setCopiedSvg] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const exportSvgCache = useRef<string | null>(null);
  const downloadRef = useRef<HTMLDivElement>(null);

  const exportSvg = async (): Promise<string> => {
    if (exportSvgCache.current === null) {
      exportSvgCache.current = await renderExportSvg(theme, `mermaid-export-${renderSeq++}`, code);
    }
    return exportSvgCache.current;
  };

  const copySvg = async () => {
    try {
      await navigator.clipboard.writeText(await exportSvg());
      setCopiedSvg(true);
      setTimeout(() => setCopiedSvg(false), 1500);
    } catch {
      /* clipboard blocked or render failed — no-op */
    }
  };

  const download = async (type: 'image/png' | 'image/jpeg') => {
    setMenuOpen(false);
    try {
      const xml = await exportSvg();
      const blob = await rasterizeSvgString(xml, {
        type,
        scale: 2,
        background: exportBackground(theme)
      });
      const ext = type === 'image/png' ? 'png' : 'jpg';
      downloadBlob(blob, `diagram.${ext}`);
    } catch {
      /* raster failed — no-op (source/SVG copy still available) */
    }
  };

  // Close the download menu on an outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!downloadRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <div className="inbox-mermaid-toolbar" role="toolbar" aria-label="Diagram actions">
      <button
        type="button"
        className={`inbox-mermaid-btn${showSource ? ' is-active' : ''}`}
        onClick={onToggleSource}
        aria-pressed={showSource}
        title={showSource ? 'Show rendered diagram' : 'Show mermaid source'}
      >
        <Code2 size={12} />
        {showSource ? 'Diagram' : 'Source'}
      </button>
      <button
        type="button"
        className="inbox-mermaid-btn"
        onClick={() => void copySvg()}
        title="Copy SVG markup"
      >
        {copiedSvg ? <Check size={12} /> : <FileImage size={12} />}
        {copiedSvg ? 'Copied' : 'SVG'}
      </button>
      <div className="inbox-mermaid-download" ref={downloadRef}>
        <button
          type="button"
          className="inbox-mermaid-btn"
          onClick={() => setMenuOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="Download as image"
        >
          <Download size={12} />
          Download
          <ChevronDown size={11} />
        </button>
        {menuOpen && (
          <div className="inbox-mermaid-menu" role="menu">
            <button
              type="button"
              className="inbox-mermaid-menu-item"
              role="menuitem"
              onClick={() => void download('image/png')}
            >
              PNG
            </button>
            <button
              type="button"
              className="inbox-mermaid-menu-item"
              role="menuitem"
              onClick={() => void download('image/jpeg')}
            >
              JPEG
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
