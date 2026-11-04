import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OnMount } from '@monaco-editor/react';
import { useData } from '../../store.js';
import { minimapAutoHidden, minimapOptionsFor } from './minimapOptions.js';

export function useMonacoMinimap(explorerFile: string | undefined, onEditorMount: OnMount) {
  const minimapPrefs = useData((s) => s.explorerMinimap);
  const updateMinimap = useData((s) => s.updateExplorerMinimap);
  const [minimapMenu, setMinimapMenu] = useState<{ x: number; y: number } | null>(null);
  const editorSubs = useRef<Array<{ dispose(): void }>>([]);

  useEffect(() => () => editorSubs.current.forEach((sub) => sub.dispose()), []);

  // Track preview width to auto-hide the minimap when narrower than 480px.
  const [monacoWidth, setMonacoWidth] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);
  const rafRef = useRef<number>(0);

  const handleMonacoRef = useCallback((el: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    if (!el) return;
    const measure = () => {
      rafRef.current = 0;
      setMonacoWidth(el.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(() => {
      if (!rafRef.current) rafRef.current = requestAnimationFrame(measure);
    });
    observer.observe(el);
    observerRef.current = observer;
  }, []);

  const minimap = useMemo(() => minimapOptionsFor(minimapPrefs, monacoWidth), [minimapPrefs, monacoWidth]);
  const autoHidden = useMemo(() => minimapAutoHidden(minimapPrefs, monacoWidth), [minimapPrefs, monacoWidth]);

  useEffect(() => setMinimapMenu(null), [explorerFile]);
  const closeMinimapMenu = useCallback(() => setMinimapMenu(null), []);

  // Right-click on the minimap or the vertical scrollbar (Monaco reports both as
  // SCROLLBAR) opens our menu; the standalone editor's built-in one is a no-op.
  const handleEditorMount: OnMount = useCallback((ed, monaco) => {
    editorSubs.current.forEach((sub) => sub.dispose());
    editorSubs.current = [
      ed.onContextMenu((e) => {
        if (e.target.type !== monaco.editor.MouseTargetType.SCROLLBAR) return;
        e.event.preventDefault();
        e.event.stopPropagation();
        setMinimapMenu({ x: e.event.posx, y: e.event.posy });
      }),
      ed.onDidScrollChange(() => setMinimapMenu(null))
    ];
    onEditorMount(ed, monaco);
  }, [onEditorMount]);

  return {
    minimap,
    minimapPrefs,
    updateMinimap,
    autoHidden,
    minimapMenu,
    handleMonacoRef,
    handleEditorMount,
    closeMinimapMenu
  };
}
