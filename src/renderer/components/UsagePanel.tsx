import { useEffect } from 'react';
import { BarChart3, RefreshCw } from 'lucide-react';
import type { UsageRollupEvent, UsageSessionEvent } from '@shared/telemetry-events';
import { useUsage } from '../store';
import { formatTokens, shortModel, formatDuration } from '../util/formatUsage';

/** Compact a plain count as "1,234" for prompts / tool / MCP call tallies. */
function formatCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  return Math.round(n).toLocaleString();
}

/**
 * Usage dashboard (WARP R2 B7, PR B) — a whole-workspace rollup of Claude
 * session ACTIVITY (tokens, prompts, tool + MCP calls), read from
 * `window.cc.usage.getSummary()` (main reads the transcripts; see
 * usage-service.ts). We track counts, not a dollar cost — a cost estimate hangs
 * on model rates that drift, whereas these are ground truth from the transcript.
 * Everything here is privacy-safe by construction: the summary is built from the
 * UGC-free {@link UsageSessionEvent} union, so the "top sessions" table can only
 * ever show id + project + persona + model + activity counts — never a prompt,
 * title, or file. There is no message preview to render because there is none in
 * the data.
 *
 * Full-width standalone panel (ListPane returns null for the `usage` nav, and
 * `.usage-panel` spans `grid-column: 2 / -1` in global.css). Mirrors the outer
 * structure of PersonasPanel.
 */
export function UsagePanel() {
  const summary = useUsage((s) => s.summary);
  const loading = useUsage((s) => s.loading);
  const loaded = useUsage((s) => s.loaded);
  const refresh = useUsage((s) => s.refresh);

  // Fetch once on mount; the summary is a point-in-time rollup, refreshed on
  // demand via the header button (no polling — a transcript read is not cheap).
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const empty = loaded && (!summary || summary.sessionCount === 0);

  return (
    <main className="settings-panel usage-panel">
      <div className="settings-inner">
        <div className="scheduler-header">
          <div className="scheduler-header-text">
            <h2>Usage</h2>
            <p className="settings-help scheduler-subtitle">
              An activity rollup across your projects' Claude sessions — tokens,
              prompts, and tool &amp; MCP calls, counted from the transcripts. It
              shows session identifiers only, never any prompt or file content.
            </p>
          </div>
          <div className="personas-header-actions">
            <button
              type="button"
              className="settings-btn"
              onClick={() => void refresh()}
              disabled={loading}
              aria-label="Refresh usage"
            >
              <RefreshCw size={12} className={loading ? 'usage-spin' : undefined} />{' '}
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {!loaded && !summary ? (
          <div className="scheduler-empty">Loading…</div>
        ) : empty ? (
          <div className="scheduler-empty">
            <BarChart3 size={28} className="scheduler-empty-icon" />
            <div className="scheduler-empty-title">No usage yet</div>
            <div className="scheduler-empty-hint">
              Run a Claude session in one of your projects and its activity will show
              up here.
            </div>
          </div>
        ) : summary ? (
          <div className="usage-body">
            <section className="usage-kpis" aria-label="Totals">
              <Kpi label="Total tokens" value={formatTokens(summary.totalTokens)} />
              <Kpi label="Prompts" value={formatCount(summary.totalPromptCount)} />
              <Kpi label="Tool calls" value={formatCount(summary.totalToolCalls)} />
              <Kpi label="MCP calls" value={formatCount(summary.totalMcpCalls)} />
              <Kpi label="Sessions" value={String(summary.sessionCount)} />
            </section>

            <div className="usage-rollups">
              <RollupCard title="By project" rows={summary.byProject} />
              <RollupCard title="By model" rows={summary.byModel} formatLabel={shortModel} />
            </div>

            <TopSessions sessions={summary.topSessions} />

            {summary.generatedAt > 0 && (
              <p className="usage-generated">
                Generated {new Date(summary.generatedAt).toLocaleString()}
              </p>
            )}
          </div>
        ) : null}
      </div>
    </main>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="usage-kpi">
      <div className="usage-kpi-value">{value}</div>
      <div className="usage-kpi-label">{label}</div>
    </div>
  );
}

/**
 * A token-ranked rollup (by project or by model) rendered as a labeled bar list.
 * Each row's bar width is relative to the largest bucket's token total, so the
 * heaviest consumer fills the bar. Rows arrive pre-sorted (tokens desc) from main.
 */
function RollupCard({
  title,
  rows,
  formatLabel
}: {
  title: string;
  rows: UsageRollupEvent[];
  formatLabel?: (label: string) => string;
}) {
  const max = rows.reduce((m, r) => Math.max(m, r.totalTokens), 0);
  return (
    <section className="usage-rollup-card" aria-label={title}>
      <h3 className="usage-rollup-title">{title}</h3>
      {rows.length === 0 ? (
        <div className="usage-rollup-empty">Nothing to show.</div>
      ) : (
        <ul className="usage-bar-list">
          {rows.map((r) => {
            const pct = max > 0 ? Math.max(2, Math.round((r.totalTokens / max) * 100)) : 0;
            return (
              <li key={`${r.dimension}:${r.label}`} className="usage-bar-row">
                <div className="usage-bar-head">
                  <span className="usage-bar-label" title={r.label}>
                    {formatLabel ? formatLabel(r.label) : r.label}
                  </span>
                  <span className="usage-bar-cost">{formatTokens(r.totalTokens)}</span>
                </div>
                <div className="usage-bar-track" aria-hidden="true">
                  <span className="usage-bar-fill" style={{ width: `${pct}%` }} />
                </div>
                <div className="usage-bar-meta">
                  {formatCount(r.promptCount)} prompts · {formatCount(r.toolCalls)} tools ·{' '}
                  {formatCount(r.mcpCalls)} mcp · {r.sessionCount}{' '}
                  {r.sessionCount === 1 ? 'session' : 'sessions'}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * The busiest sessions, descending by tokens. PRIVACY: each row shows only the
 * session's identifiers + activity counts/model/duration — there is no message
 * preview column because the {@link UsageSessionEvent} shape carries no content.
 */
function TopSessions({ sessions }: { sessions: UsageSessionEvent[] }) {
  if (sessions.length === 0) return null;
  return (
    <section className="usage-top" aria-label="Top sessions">
      <h3 className="usage-rollup-title">Top sessions</h3>
      <table className="usage-table">
        <thead>
          <tr>
            <th scope="col">Project</th>
            <th scope="col">Model</th>
            <th scope="col" className="usage-num">
              Tokens
            </th>
            <th scope="col" className="usage-num">
              Prompts
            </th>
            <th scope="col" className="usage-num">
              Tools
            </th>
            <th scope="col" className="usage-num">
              MCP
            </th>
            <th scope="col" className="usage-num">
              Duration
            </th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.sessionId}>
              <td>
                <span className="usage-cell-project" title={s.projectName}>
                  {s.projectName}
                </span>
                {s.persona && <span className="usage-cell-persona">{s.persona}</span>}
              </td>
              <td className="usage-cell-model">{s.model ? shortModel(s.model) : '—'}</td>
              <td className="usage-num">
                {s.totalTokens !== undefined ? formatTokens(s.totalTokens) : '—'}
              </td>
              <td className="usage-num">
                {s.promptCount !== undefined ? formatCount(s.promptCount) : '—'}
              </td>
              <td className="usage-num">
                {s.toolCalls !== undefined ? formatCount(s.toolCalls) : '—'}
              </td>
              <td className="usage-num">
                {s.mcpCalls !== undefined ? formatCount(s.mcpCalls) : '—'}
              </td>
              <td className="usage-num">
                {s.durationMs !== undefined ? formatDuration(s.durationMs) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
