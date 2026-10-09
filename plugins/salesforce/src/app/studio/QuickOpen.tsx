import { useEffect, useMemo, useRef, useState } from 'react';

export interface QuickOpenItem { id: string; label: string; detail?: string; kind: string }

/** Subsequence match; lower scores rank first. Returns null when `query` does not match. */
export function fuzzyScore(label: string, query: string): number | null {
  const text = label.toLowerCase();
  const needle = query.toLowerCase().replace(/\s+/g, '');
  if (!needle) return 0;
  const direct = text.indexOf(needle);
  if (direct >= 0) return direct;
  let from = 0;
  let score = 100;
  for (const char of needle) {
    const at = text.indexOf(char, from);
    if (at < 0) return null;
    score += at - from;
    from = at + 1;
  }
  return score;
}

export function rankQuickOpen(items: QuickOpenItem[], query: string, limit = 50): QuickOpenItem[] {
  if (!query.trim()) return items.slice(0, limit);
  return items
    .map(item => ({ item, score: Math.min(...[fuzzyScore(item.label, query), fuzzyScore(item.detail ?? '', query) === null ? null : 200].filter((s): s is number => s !== null), Infinity) }))
    .filter(row => row.score !== Infinity)
    .sort((a, b) => a.score - b.score || a.item.label.localeCompare(b.item.label))
    .slice(0, limit).map(row => row.item);
}

/** Cmd/Ctrl+P file switcher. In compact mode it replaces the explorer. */
export function QuickOpen({ items, onPick, onClose }: { items: QuickOpenItem[]; onPick(item: QuickOpenItem): void; onClose(): void }) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(() => rankQuickOpen(items, query), [items, query]);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { setCursor(0); }, [query]);
  const pick = (item?: QuickOpenItem) => { if (item) { onPick(item); onClose(); } };
  return <div className="sf-quickopen-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="sf-quickopen" role="dialog" aria-modal="true" aria-label="Quick open"
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
        else if (event.key === 'ArrowDown') { event.preventDefault(); setCursor(value => Math.min(results.length - 1, value + 1)); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); setCursor(value => Math.max(0, value - 1)); }
        else if (event.key === 'Enter') { event.preventDefault(); pick(results[cursor]); }
      }}>
      <input ref={input} className="sf-quickopen-input" role="combobox" aria-expanded="true" aria-controls="sf-quickopen-list" aria-activedescendant={results[cursor] ? `sf-qo-${cursor}` : undefined}
        aria-label="Search files and actions" placeholder="Go to file, action or test…" value={query} onChange={event => setQuery(event.target.value)} />
      <ul id="sf-quickopen-list" role="listbox" className="sf-quickopen-list">
        {results.map((item, index) => <li key={`${item.kind}:${item.id}`} id={`sf-qo-${index}`} role="option" aria-selected={index === cursor}
          className={index === cursor ? 'is-active' : undefined} onMouseEnter={() => setCursor(index)} onClick={() => pick(item)}>
          <span className="sf-quickopen-kind">{item.kind}</span><span className="sf-quickopen-label">{item.label}</span>
          {item.detail && <span className="sf-quickopen-detail">{item.detail}</span>}
        </li>)}
        {results.length === 0 && <li className="sf-quickopen-empty" role="presentation">No matches</li>}
      </ul>
    </div>
  </div>;
}
