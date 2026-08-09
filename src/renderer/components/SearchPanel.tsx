import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { Project, SearchHit, SearchResult } from '@shared/types';
import { useUi } from '../store';

interface Props {
  project: Project;
  onClose: () => void;
}

export function SearchPanel({ project, onClose }: Props) {
  const setExplorerFile = useUi((s) => s.setExplorerFile);
  const setWorkspaceMode = useUi((s) => s.setWorkspaceMode);
  const requestExplorerGoto = useUi((s) => s.requestExplorerGoto);
  const pushToast = useUi((s) => s.pushToast);

  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [running, setRunning] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const reqIdRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Keep the highlighted row in view when arrow-keying past the visible
  // window. Same pattern as CommandPalette/QuickOpen/ResumePicker.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResult(null);
      setRunning(false);
      return;
    }
    const id = ++reqIdRef.current;
    setRunning(true);
    const handle = window.setTimeout(async () => {
      try {
        const r = await window.cc.fs.searchFiles(project.path, q, {
          caseSensitive,
          regex
        });
        if (reqIdRef.current !== id) return;
        setResult(r);
      } catch (err) {
        if (reqIdRef.current !== id) return;
        pushToast(err instanceof Error ? err.message : String(err), 'error');
      } finally {
        if (reqIdRef.current === id) setRunning(false);
      }
    }, 220);
    return () => window.clearTimeout(handle);
  }, [query, caseSensitive, regex, project.path, pushToast]);

  useEffect(() => {
    setActiveIdx(0);
  }, [result]);

  const hits = result?.hits ?? [];

  const matchRe = useMemo<RegExp | null>(() => {
    const q = query.trim();
    if (!q || !result) return null;
    try {
      const pat = regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(pat, caseSensitive ? 'g' : 'gi');
    } catch {
      return null;
    }
  }, [query, regex, caseSensitive, result]);

  const choose = (hit: SearchHit) => {
    setWorkspaceMode(project.id, 'explorer');
    setExplorerFile(project.id, hit.path);
    requestExplorerGoto(project.id, hit.line, hit.column);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, hits.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      setActiveIdx(0);
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      setActiveIdx(Math.max(0, hits.length - 1));
      return;
    }
    if (e.key === 'PageDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 8, hits.length - 1));
      return;
    }
    if (e.key === 'PageUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 8, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const h = hits[activeIdx];
      if (h) choose(h);
    }
  };

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette search-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="search-input-row">
          <Search size={14} className="search-input-icon" />
          <input
            ref={inputRef}
            className="palette-input search-input"
            placeholder={`Search in ${project.name}…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button
            type="button"
            className={`search-toggle ${caseSensitive ? 'on' : ''}`}
            title="Match case"
            aria-pressed={caseSensitive}
            onClick={() => setCaseSensitive((v) => !v)}
          >
            Aa
          </button>
          <button
            type="button"
            className={`search-toggle ${regex ? 'on' : ''}`}
            title="Use regex"
            aria-pressed={regex}
            onClick={() => setRegex((v) => !v)}
          >
            .*
          </button>
        </div>
        <div className="palette-list search-list" ref={listRef}>
          {!query.trim() ? (
            <div className="palette-empty">Type to search file contents…</div>
          ) : running && !result ? (
            <div className="palette-empty">Searching…</div>
          ) : hits.length === 0 ? (
            <div className="palette-empty">No matches</div>
          ) : (
            hits.map((h, i) => (
              <button
                key={`${h.path}:${h.line}:${h.column}`}
                data-idx={i}
                className={`palette-item search-item ${i === activeIdx ? 'active' : ''}`}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => choose(h)}
              >
                <span className="search-line-no">{h.line}</span>
                <span className="search-preview">{highlight(h.preview, matchRe)}</span>
                <span className="search-rel">{h.rel}</span>
              </button>
            ))
          )}
        </div>
        {result && (
          <div className="search-footer">
            {hits.length} {hits.length === 1 ? 'match' : 'matches'} · {result.scanned} files
            {result.truncated ? ' · truncated' : ''}
          </div>
        )}
      </div>
    </div>
  );
}

function highlight(text: string, re: RegExp | null): React.ReactNode {
  if (!re) return text;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(<mark key={key++}>{m[0]}</mark>);
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
