import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Code2, Download, Expand, FileImage, Minus, Plus, RotateCcw, X } from 'lucide-react';
import { rasterizeSvgString, downloadBlob } from '../lib/mermaidExport.js';
import { mermaidSvgLayout } from '../lib/mermaid-svg-layout.js';
import {
  mermaidSvgCacheKey,
  readMermaidSvgCache,
  writeMermaidSvgCache
} from '../lib/mermaid-svg-cache.js';
import { Modal } from './Modal.js';

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
  if (typeof document === 'undefined') return 'dark';
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
    fontFamily: 'inherit',
    // Pixel-sized SVG (not width=100%). Combined with mermaidSvgLayout this
    // keeps the graph from oscillating inside a fit-content thread bubble.
    flowchart: { useMaxWidth: false },
    sequence: { useMaxWidth: false },
    suppressErrorRendering: true
  });
  try {
    const { svg } = await mermaid.render(id, code);
    return svg;
  } finally {
    document.getElementById(id)?.remove();
    document.getElementById(`d${id}`)?.remove();
  }
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
  const resolvedTheme = theme ?? currentTheme();
  const cacheKey = mermaidSvgCacheKey(resolvedTheme, code);
  const [svg, setSvg] = useState<string | null>(() => readMermaidSvgCache(cacheKey) ?? null);
  const [error, setError] = useState(false);
  // Toolbar "Source" toggle: swap the rendered diagram for its raw mermaid
  // code block in place. Only reachable via the exportable toolbar.
  const [showSource, setShowSource] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const layout = useMemo(() => (svg ? mermaidSvgLayout(svg) : null), [svg]);

  useEffect(() => {
    let cancelled = false;
    const cached = readMermaidSvgCache(cacheKey);
    if (cached) {
      setSvg(cached);
      setError(false);
      return;
    }
    // Keep the last good SVG on screen while a new render runs. Clearing it
    // flashes "Rendering diagram…" (and a height jump) on every remount —
    // the thread transcript ticks `now` every second and react-markdown
    // rebuilds this component with empty state.
    setError(false);

    void (async () => {
      try {
        const id = `inbox-mermaid-${renderSeq++}`;
        const rendered = await renderToSvg(resolvedTheme, id, code);
        writeMermaidSvgCache(cacheKey, rendered);
        if (!cancelled) {
          setSvg(rendered);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cacheKey, code, resolvedTheme]);

  // `data-mermaid` marks every mounted diagram (any state); `data-mermaid-state`
  // distinguishes a still-rendering one from a settled (svg/error) one. The PDF
  // export counts these to know when ALL expected diagrams have finished — a
  // plain "no loading node visible" check can't tell "done" from "not yet
  // mounted" and would snapshot the placeholder. See renderReportHtml.
  if (error && svg === null) {
    return (
      <pre className="inbox-md-code" data-mermaid="1" data-mermaid-state="settled">
        {code}
      </pre>
    );
  }
  if (svg === null || layout === null) {
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
          onExpand={() => setExpanded(true)}
        />
      )}
      {showSource ? (
        // "Source" toggled on: show the raw mermaid instead of the diagram.
        <pre className="inbox-md-code inbox-mermaid-source">{code}</pre>
      ) : (
        // mermaid output is its own trusted SVG (securityLevel 'strict'
        // sanitizes the diagram source); inject it as markup. Aspect-ratio
        // on the frame is the layout lock: the SVG cannot change the box.
        <div
          className={`inbox-mermaid-frame${layout.aspectRatio ? ' is-sized' : ''}`}
          style={layout.aspectRatio ? { aspectRatio: layout.aspectRatio } : undefined}
          dangerouslySetInnerHTML={{ __html: layout.svg }}
        />
      )}
      {expanded && (
        <MermaidExpandedView
          code={code}
          svg={svg}
          theme={theme ?? currentTheme()}
          onClose={() => setExpanded(false)}
        />
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
  onToggleSource,
  onExpand
}: {
  code: string;
  theme: MermaidTheme;
  showSource: boolean;
  onToggleSource: () => void;
  onExpand: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const exportSvgCache = useRef<string | null>(null);
  const downloadRef = useRef<HTMLDivElement>(null);

  const exportSvg = async (): Promise<string> => {
    if (exportSvgCache.current === null) {
      exportSvgCache.current = await renderExportSvg(theme, `mermaid-export-${renderSeq++}`, code);
    }
    return exportSvgCache.current;
  };

  const downloadSvg = async () => {
    setMenuOpen(false);
    try {
      downloadBlob(new Blob([await exportSvg()], { type: 'image/svg+xml;charset=utf-8' }), 'diagram.svg');
    } catch {
      /* render failed — no-op */
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
        className="inbox-mermaid-btn inbox-mermaid-expand"
        onClick={onExpand}
        title="Open diagram in full screen"
        aria-label="Open diagram in full screen"
      >
        <Expand size={13} />
      </button>
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
              onClick={() => {
                void downloadSvg();
              }}
            >
              <FileImage size={12} />
              SVG
            </button>
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

/** A focused workspace for inspecting large diagrams without changing the report. */
function MermaidExpandedView({
  code,
  svg,
  theme,
  onClose
}: {
  code: string;
  svg: string;
  theme: MermaidTheme;
  onClose: () => void;
}) {
  const [scale, setScale] = useState(1);
  const [showSource, setShowSource] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const diagramRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);
  const zoom = (delta: number) =>
    setScale((current) => Math.max(0.25, Math.min(3, Math.round((current + delta) * 100) / 100)));

  const fit = () => {
    const canvas = canvasRef.current;
    const diagram = diagramRef.current?.querySelector('svg');
    if (!canvas || !diagram) return;
    const viewBox = diagram.viewBox.baseVal;
    const width = viewBox.width || diagram.getBoundingClientRect().width;
    const height = viewBox.height || diagram.getBoundingClientRect().height;
    if (!width || !height) return;
    const next = Math.max(0.25, Math.min(1, Math.min((canvas.clientWidth - 96) / width, (canvas.clientHeight - 96) / height)));
    setScale(Math.round(next * 100) / 100);
    requestAnimationFrame(() => {
      canvas.scrollLeft = Math.max(0, (canvas.scrollWidth - canvas.clientWidth) / 2);
      canvas.scrollTop = Math.max(0, (canvas.scrollHeight - canvas.clientHeight) / 2);
    });
  };

  useEffect(() => {
    if (!showSource) fit();
  }, [showSource]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && (event.key === '+' || event.key === '=')) {
        event.preventDefault();
        zoom(0.25);
      }
      if ((event.metaKey || event.ctrlKey) && event.key === '-') {
        event.preventDefault();
        zoom(-0.25);
      }
      if ((event.metaKey || event.ctrlKey) && event.key === '0') {
        event.preventDefault();
        setScale(1);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <Modal
      title="Diagram"
      onClose={onClose}
      className="mermaid-expanded-modal"
      bodyClassName="mermaid-expanded-body"
      header={<div className="mermaid-expanded-header"><h3>Diagram</h3></div>}
      hideClose
    >
      <div className="mermaid-expanded-toolbar" role="toolbar" aria-label="Diagram zoom controls">
        <button type="button" className="mermaid-expanded-btn" onClick={() => zoom(-0.25)} disabled={scale <= 0.25} title="Zoom out" aria-label="Zoom out">
          <Minus size={14} />
        </button>
        <button type="button" className="mermaid-expanded-btn" onClick={() => zoom(0.25)} disabled={scale >= 3} title="Zoom in" aria-label="Zoom in">
          <Plus size={14} />
        </button>
        <button type="button" className="mermaid-expanded-btn" onClick={() => setScale(1)} disabled={scale === 1} title="Reset zoom" aria-label="Reset zoom">
          <RotateCcw size={14} />
        </button>
        <button
          type="button"
          className={`mermaid-expanded-btn${showSource ? ' is-active' : ''}`}
          onClick={() => setShowSource((value) => !value)}
          aria-pressed={showSource}
          title={showSource ? 'Show diagram' : 'Show source'}
          aria-label={showSource ? 'Show diagram' : 'Show source'}
        >
          <Code2 size={14} />
        </button>
        <span className="mermaid-expanded-toolbar-separator" aria-hidden="true" />
        <button type="button" className="mermaid-expanded-btn" onClick={onClose} title="Close diagram" aria-label="Close diagram">
          <X size={16} />
        </button>
      </div>
      <div
        ref={canvasRef}
        className="mermaid-expanded-canvas"
        aria-label="Expanded diagram. Use the zoom controls or Command or Control plus and minus. Drag to pan."
        onWheel={(event) => {
          if (!event.ctrlKey && !event.metaKey) return;
          event.preventDefault();
          zoom(event.deltaY < 0 ? 0.1 : -0.1);
        }}
        onPointerDown={(event) => {
          if (showSource || event.button !== 0) return;
          panRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const pan = panRef.current;
          if (!pan || pan.id !== event.pointerId) return;
          event.currentTarget.scrollLeft = pan.left - (event.clientX - pan.x);
          event.currentTarget.scrollTop = pan.top - (event.clientY - pan.y);
        }}
        onPointerUp={(event) => {
          if (panRef.current?.id === event.pointerId) panRef.current = null;
        }}
      >
        {showSource ? (
          <pre className="inbox-md-code inbox-mermaid-source">{code}</pre>
        ) : (
          <div
            className="mermaid-expanded-scale-box"
            style={{ width: `${scale * 100}%`, height: `${scale * 100}%` }}
          >
            <div
              ref={diagramRef}
              className="mermaid-expanded-diagram"
              style={{ transform: `scale(${scale})` }}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>
        )}
      </div>
      <div className="mermaid-expanded-footer">{theme === 'default' ? 'Light' : 'Dark'} theme. Drag to pan; Command or Control +/− or pinch zooms.</div>
    </Modal>
  );
}
