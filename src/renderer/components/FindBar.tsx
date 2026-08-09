import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useUi } from '../store';
import { getFinder } from '../util/findRegistry';

interface Props {
  sessionId: string;
}

export function FindBar({ sessionId }: Props) {
  const setFindOpen = useUi((s) => s.setFindOpen);
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [sessionId]);

  const close = () => {
    getFinder(sessionId)?.clear();
    setFindOpen(false);
  };

  const search = (dir: 'next' | 'prev') => {
    const f = getFinder(sessionId);
    if (!f || !query) return;
    const ok =
      dir === 'next'
        ? f.findNext(query, { caseSensitive })
        : f.findPrev(query, { caseSensitive });
    setNotFound(!ok);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      search(e.shiftKey ? 'prev' : 'next');
    }
  };

  return (
    <div className="find-bar">
      <input
        ref={inputRef}
        className="find-input"
        placeholder="Find in terminal"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setNotFound(false);
        }}
        onKeyDown={onKeyDown}
      />
      <button
        className={`find-toggle ${caseSensitive ? 'on' : ''}`}
        onClick={() => setCaseSensitive((v) => !v)}
        title="Match case"
      >
        Aa
      </button>
      <button className="icon-btn" onClick={() => search('prev')} title="Previous (Shift+Enter)">
        <ChevronUp size={14} />
      </button>
      <button className="icon-btn" onClick={() => search('next')} title="Next (Enter)">
        <ChevronDown size={14} />
      </button>
      <button className="icon-btn" onClick={close} title="Close (Esc)">
        <X size={14} />
      </button>
      {notFound && query && <span className="find-status">No match</span>}
    </div>
  );
}
