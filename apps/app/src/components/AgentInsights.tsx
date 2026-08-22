import { product } from '../lib/product-client.js';
import { useEffect, useState } from 'react';
import { FileText, FileCode, FileJson, FilePlus } from 'lucide-react';
import type { SessionStats } from '@zana-ai/zcc-domain/product';

/**
 * Transcript-derived, display-only agent insights — Model · Context · Usage · Files ·
 * Queue — shared by the Agent Monitor status pane and the agent-inspector modal.
 * All data comes from `terminals.sessionStats`. Nothing here is fabricated: each
 * section renders only when its data is present, so a fresh / unsupported / headless
 * agent shows nothing rather than empty scaffolding or inferred values.
 */

/** Compact a token count as "44.9k" / "1.2M" for the context readout. */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function totalTokens(tokens: NonNullable<SessionStats['tokens']>): number {
  return tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
}

/** Strip the vendor prefix/date off a model id → "sonnet-4-5" from
 *  "claude-sonnet-4-5-20250929", leaving a short human label. */
function shortModel(model: string): string {
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '');
}

/** Rough context-window budget per model family, for the fill bar (tokens). A
 *  guide only — the exact window varies, so this is deliberately generous. */
function contextBudget(model: string | undefined): number {
  const m = (model ?? '').toLowerCase();
  if (m.includes('[1m]') || m.includes('-1m')) return 1_000_000;
  return 200_000;
}

/**
 * Poll a session's transcript-derived stats while it's mounted. Refreshes on a
 * gentle interval (the transcript is append-only and we only need a live-ish
 * read, not per-frame). Clears immediately on session change so one agent's
 * numbers never flash under another. Null until the first read resolves; an
 * exited agent's transcript is frozen, so it's read once and not polled.
 */
export function useSessionStats(
  sessionId: string,
  projectId: string,
  exited: boolean,
  enabled = true
): SessionStats | null {
  const [stats, setStats] = useState<SessionStats | null>(null);
  useEffect(() => {
    setStats(null);
    if (!enabled) return;
    let alive = true;
    const pull = () => {
      void product.terminals
        .sessionStats(projectId, sessionId)
        .then((s) => {
          if (alive) setStats(s);
        })
        .catch(() => {});
    };
    pull();
    if (exited) return () => { alive = false; };
    const timer = setInterval(pull, 4_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [sessionId, projectId, exited, enabled]);
  return stats;
}

const FILE_OP_TITLE: Record<SessionStats['files'][number]['op'], string> = {
  R: 'Read',
  C: 'Created',
  W: 'Wrote / edited'
};

/** A file-type glyph from the basename's extension, so a Files row reads at a
 *  glance (code vs config vs prose) — echoing the icons in the reference design.
 *  A created file (op C) always gets the "plus" glyph regardless of extension. */
function fileGlyph(name: string, op: SessionStats['files'][number]['op'], size = 13) {
  if (op === 'C') return <FilePlus size={size} />;
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'json') return <FileJson size={size} />;
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'css', 'sh'].includes(ext))
    return <FileCode size={size} />;
  return <FileText size={size} />;
}

/**
 * The transcript-derived insight sections. `maxFiles`/`maxQueue` cap the lists
 * (the modal has more room than the monitor's narrow rail). Renders a Fragment
 * of `.agent-insight` blocks; the caller wraps them in its own container so the
 * spacing matches its surface.
 */
export function AgentInsights({
  stats,
  maxFiles = 8,
  maxQueue = 6
}: {
  stats: SessionStats | null;
  maxFiles?: number;
  maxQueue?: number;
}) {
  if (!stats) return null;
  const { model, harnessVersion, agent, contextTokens, tokens, files, queue } = stats;
  const completedCount = queue.filter((q) => q.status === 'completed').length;
  const totalCount = queue.length;
  const allTodosCompleted = totalCount > 0 && completedCount === totalCount;
  const budget = contextBudget(model);
  const pct = contextTokens ? Math.min(100, Math.round((contextTokens / budget) * 100)) : 0;
  const hasAny =
    !!model ||
    !!harnessVersion ||
    !!agent ||
    typeof contextTokens === 'number' ||
    !!tokens ||
    files.length > 0 ||
    queue.length > 0;
  if (!hasAny) return null;

  return (
    <>
      {model && (
        <div className="agent-insight">
          <div className="agent-insight-label">Model</div>
          <div className="agent-insight-model">{shortModel(model)}</div>
        </div>
      )}

      {harnessVersion && (
        <div className="agent-insight">
          <div className="agent-insight-label">Version</div>
          <div className="agent-insight-model">{harnessVersion}</div>
        </div>
      )}

      {agent && (
        <div className="agent-insight">
          <div className="agent-insight-label">Agent</div>
          <div className="agent-insight-model">{agent}</div>
        </div>
      )}

      {typeof contextTokens === 'number' && (
        <div className="agent-insight">
          <div className="agent-insight-label">Context</div>
          <div className="agent-context-bar" aria-hidden="true">
            <span className="agent-context-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="agent-context-figures">{formatTokens(contextTokens)}</div>
        </div>
      )}

      {tokens && (
        <div className="agent-insight">
          <div className="agent-insight-label">Usage</div>
          <details className="agent-usage-details">
            <summary>{formatTokens(totalTokens(tokens))} session total</summary>
            <dl className="agent-usage-breakdown">
              <div><dt>Input</dt><dd>{formatTokens(tokens.input)}</dd></div>
              <div><dt>Output</dt><dd>{formatTokens(tokens.output)}</dd></div>
              <div><dt>Cache read</dt><dd>{formatTokens(tokens.cacheRead)}</dd></div>
              <div><dt>Cache write</dt><dd>{formatTokens(tokens.cacheWrite)}</dd></div>
            </dl>
          </details>
        </div>
      )}

      {files.length > 0 && (
        <div className="agent-insight">
          <div className="agent-insight-label">Files</div>
          <ul className="agent-file-list">
            {files.slice(0, maxFiles).map((f) => {
              const name = f.path.split('/').pop() || f.path;
              return (
                <li key={`${f.op}:${f.path}`} className={`agent-file-row op-${f.op}`} title={f.path}>
                  <span className="agent-file-glyph" aria-hidden="true">
                    {fileGlyph(name, f.op)}
                  </span>
                  <span className="agent-file-name">{name}</span>
                  <span className="agent-file-op" title={FILE_OP_TITLE[f.op]}>
                    {f.op}
                  </span>
                </li>
              );
            })}
            {files.length > maxFiles && (
              <li className="agent-file-more">+{files.length - maxFiles} more</li>
            )}
          </ul>
        </div>
      )}

      {queue.length > 0 && (
        <div className="agent-insight">
          <div className="agent-insight-label">Queue</div>
          {allTodosCompleted ? (
            <div className="agent-queue-summary">
              {completedCount} of {totalCount} To-dos Completed
            </div>
          ) : (
            <ol className="agent-queue-list">
              {queue.slice(0, maxQueue).map((q, i) => (
                <li key={i} className={`agent-queue-row status-${q.status}`}>
                  {q.text}
                </li>
              ))}
              {queue.length > maxQueue && (
                <li className="agent-queue-more">+{queue.length - maxQueue} more</li>
              )}
            </ol>
          )}
        </div>
      )}
    </>
  );
}
