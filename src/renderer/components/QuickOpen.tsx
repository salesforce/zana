import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import type { Project, WalkedFile } from '@shared/types';
import { useUi } from '../store';
import { fuzzyScore } from '../util/fuzzy';
import { highlightMatches } from './palette/highlight';

interface Props {
  project: Project;
  onClose: () => void;
}

interface ScoredEntry {
  file: WalkedFile;
  score: number;
  matchIdx: number[];
}

const MAX_RESULTS = 80;

// File cache per project root, lifetime = renderer process.
const fileCache = new Map<string, WalkedFile[]>();

export function QuickOpen({ project, onClose }: Props) {
  const setExplorerFile = useUi((s) => s.setExplorerFile);
  const setWorkspaceMode = useUi((s) => s.setWorkspaceMode);
  const recents = useUi((s) => s.recentFiles[project.id]);

  const [files, setFiles] = useState<WalkedFile[] | null>(
    () => fileCache.get(project.path) ?? null
  );
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Keep the highlighted row in view when arrow-keying past the visible
  // window. Same pattern as CommandPalette.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  useEffect(() => {
    if (files !== null) return;
    let cancelled = false;
    window.cc.fs.walkFiles(project.path)
      .then((list) => {
        if (cancelled) return;
        fileCache.set(project.path, list);
        setFiles(list);
      })
      .catch(() => {
        if (!cancelled) setFiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [files, project.path]);

  const results = useMemo<ScoredEntry[]>(() => {
    if (!files) return [];
    const q = query.trim();
    if (!q) {
      // Empty query: lead with the project's MRU, then fall back to walk order.
      const seen = new Set<string>();
      const byPath = new Map(files.map((f) => [f.path, f] as const));
      const out: ScoredEntry[] = [];
      for (const path of recents ?? []) {
        const f = byPath.get(path);
        if (!f) continue;
        seen.add(path);
        out.push({ file: f, score: 0, matchIdx: [] });
        if (out.length >= MAX_RESULTS) return out;
      }
      for (const f of files) {
        if (seen.has(f.path)) continue;
        out.push({ file: f, score: 0, matchIdx: [] });
        if (out.length >= MAX_RESULTS) break;
      }
      return out;
    }
    const out: ScoredEntry[] = [];
    for (const file of files) {
      const r = fuzzyScore(file.rel, q);
      if (r) out.push({ file, score: r.score, matchIdx: r.matchIdx });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, MAX_RESULTS);
  }, [files, query, recents]);

  useEffect(() => {
    if (activeIdx >= results.length) setActiveIdx(0);
  }, [results, activeIdx]);

  const choose = (entry: ScoredEntry) => {
    setWorkspaceMode(project.id, 'explorer');
    setExplorerFile(project.id, entry.file.path);
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
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
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
      setActiveIdx(Math.max(0, results.length - 1));
      return;
    }
    if (e.key === 'PageDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 8, results.length - 1));
      return;
    }
    if (e.key === 'PageUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 8, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const r = results[activeIdx];
      if (r) choose(r);
    }
  };

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder={
            files === null
              ? `Indexing ${project.name}…`
              : `Find file in ${project.name} (${files.length}${
                  files.length >= 8000 ? '+' : ''
                })`
          }
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={files === null}
        />
        <div className="palette-list" ref={listRef}>
          {files === null ? (
            <div className="palette-empty">Indexing project files…</div>
          ) : results.length === 0 ? (
            <div className="palette-empty">No matches</div>
          ) : (
            results.map((r, i) => (
              <button
                key={r.file.path}
                data-idx={i}
                className={`palette-item ${i === activeIdx ? 'active' : ''}`}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => choose(r)}
              >
                <span className="palette-icon">
                  <FileText size={14} />
                </span>
                <span className="palette-label">{highlightMatches(r.file.rel, r.matchIdx)}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}


