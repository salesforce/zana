import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useMonacoTheme } from '../util/useMonacoTheme';

// Lazily loaded so react-diff-viewer-continued (+ emotion / diff / js-yaml) is
// code-split out of the entry chunk and fetched only when a diff first renders.
const DiffViewerInner = lazy(() => import('./DiffViewerInner'));

/**
 * A lightweight read-only inline diff view for Agent Changes.
 * We keep the wrapper API stable for callers (`fitContent` + height callback)
 * so AgentDiffPanel virtualization continues to work unchanged.
 */
export function DiffViewer({
  original,
  modified,
  language,
  path,
  fitContent = false,
  compact = false,
  onContentHeightChange
}: {
  original: string;
  modified: string;
  language?: string;
  path: string;
  fitContent?: boolean;
  compact?: boolean;
  onContentHeightChange?: (height: number) => void;
}) {
  const monacoTheme = useMonacoTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(260);
  const lastReportedHeightRef = useRef<number>(260);
  const onContentHeightChangeRef = useRef(onContentHeightChange);
  onContentHeightChangeRef.current = onContentHeightChange;
  useEffect(() => {
    if (!fitContent || !containerRef.current) return;
    const el = containerRef.current;
    const reportHeight = () => {
      const nextHeight = Math.max(80, Math.ceil(el.scrollHeight));
      if (nextHeight === lastReportedHeightRef.current) return;
      lastReportedHeightRef.current = nextHeight;
      setContentHeight(nextHeight);
      onContentHeightChangeRef.current?.(nextHeight);
    };
    reportHeight();
    const observer = new ResizeObserver(() => reportHeight());
    observer.observe(el);
    return () => observer.disconnect();
  }, [fitContent, original, modified, path]);

  const compactStyles = useMemo(
    () => ({
      contentText: {
        fontSize: compact ? 11.5 : 12,
        lineHeight: compact ? '17px' : '18px',
        fontFamily:
          "JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace"
      },
      gutter: {
        minWidth: compact ? 38 : 42,
        padding: '0 8px'
      },
      line: {
        padding: 0
      },
      marker: {
        minWidth: 14
      }
    }),
    [compact]
  );

  return (
    <div
      ref={containerRef}
      className="agent-diff-viewer"
      data-path={path}
      data-language={language ?? ''}
      aria-label={`Diff for ${path}`}
      data-compact={compact ? 'true' : 'false'}
      style={{ height: fitContent ? `${contentHeight}px` : '100%', width: '100%' }}
    >
      <Suspense fallback={null}>
        <DiffViewerInner
          original={original}
          modified={modified}
          compactStyles={compactStyles}
          isDark={monacoTheme === 'vs-dark'}
        />
      </Suspense>
    </div>
  );
}
