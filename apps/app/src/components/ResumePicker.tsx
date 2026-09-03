import { useEffect, useMemo, useRef, useState } from 'react';
import { Clock, MessagesSquare } from 'lucide-react';
import type { ClaudeSessionSummary, Project } from '@zana-ai/zcc-domain/product';
import { profileLabel } from '@zana-ai/zcc-domain/launch-provider';
import { useData, useUi } from '../store.js';
import { fuzzyScore } from '../lib/fuzzy.js';
import { StencilList } from './ui/Skeleton.js';

interface Props {
  project: Project;
  onClose: () => void;
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function ResumePicker({ project, onClose }: Props) {
  const sessions = useData((s) => s.claudeSessions[project.id]);
  const load = useData((s) => s.loadClaudeSessions);
  const createTerminal = useData((s) => s.createTerminal);
  const selectTab = useUi((s) => s.selectTab);
  const setProjectView = useUi((s) => s.setProjectView);

  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    load(project.id);
    inputRef.current?.focus();
  }, [project.id, load]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  const filtered = useMemo<ClaudeSessionSummary[]>(() => {
    if (!sessions) return [];
    const q = query.trim();
    if (!q) return sessions;
    // Score on the prompt (primary signal) and id (rare but useful when the
    // user remembers a session hash). Sessions without a prompt fall back to
    // the id alone. Stable order preserved on tie via original index.
    const scored: Array<{ s: ClaudeSessionSummary; score: number; idx: number }> = [];
    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i];
      const tm = s.title ? fuzzyScore(s.title, q) : null;
      const pm = s.firstUserPrompt ? fuzzyScore(s.firstUserPrompt, q) : null;
      const im = fuzzyScore(s.id, q);
      const score = Math.max(
        tm?.score ?? -Infinity,
        pm?.score ?? -Infinity,
        (im?.score ?? -Infinity) * 0.5
      );
      if (score > -Infinity) scored.push({ s, score, idx: i });
    }
    scored.sort((a, b) => (b.score - a.score) || (a.idx - b.idx));
    return scored.map((x) => x.s);
  }, [sessions, query]);

  useEffect(() => {
    if (activeIdx >= filtered.length) setActiveIdx(0);
  }, [filtered, activeIdx]);

  const resume = async (s: ClaudeSessionSummary) => {
    const session = await createTerminal(project.id, 'claude', 80, 24, {
      extraArgs: ['--resume', s.id],
      // Carry the session's own short name onto the resumed tab when it has one,
      // so the tab matches what the picker showed; else the resume marker.
      title: s.title ?? `${profileLabel('claude-resume')} · ${s.id.slice(0, 7)}`
    });
    if (session) {
      selectTab(project.id, session.id);
      setProjectView(project.id, 'terminals');
    }
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
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
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
      setActiveIdx(Math.max(0, filtered.length - 1));
      return;
    }
    if (e.key === 'PageDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 8, filtered.length - 1));
      return;
    }
    if (e.key === 'PageUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 8, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const s = filtered[activeIdx];
      if (s) resume(s);
    }
  };

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder={
            sessions === undefined
              ? `Loading Claude sessions for ${project.name}…`
              : `Resume Claude session in ${project.name} (${sessions.length})`
          }
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={sessions === undefined}
        />
        <div className="palette-list" ref={listRef}>
          {sessions === undefined ? (
            <StencilList label="Loading sessions" className="palette-empty" />
          ) : sessions.length === 0 ? (
            <div className="palette-empty">No previous Claude sessions for this folder.</div>
          ) : filtered.length === 0 ? (
            <div className="palette-empty">No matches</div>
          ) : (
            filtered.map((s, i) => (
              <button
                key={s.id}
                data-idx={i}
                className={`palette-item resume-item ${i === activeIdx ? 'active' : ''}`}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => resume(s)}
              >
                <span className="resume-prompt">
                  {/* The session's short name (/rename, else Claude's ai-title)
                      when set; otherwise its opening prompt. */}
                  {s.title ?? s.firstUserPrompt ?? <em className="dim">empty session</em>}
                </span>
                <span className="resume-meta">
                  <span title={new Date(s.lastActiveAt).toLocaleString()}>
                    <Clock size={11} /> {timeAgo(s.lastActiveAt)}
                  </span>
                  <span>
                    <MessagesSquare size={11} /> {s.messageCount}
                  </span>
                  <span className="resume-id">{s.id.slice(0, 7)}</span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
