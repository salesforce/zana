import { Sparkles } from 'lucide-react';
import type { StudioDiagnostic } from '../../../lib/studio-contract.js';

const SEVERITY_ORDER: Record<StudioDiagnostic['severity'], number> = { error: 0, warning: 1, info: 2, hint: 3 };
const SEVERITY_MARK: Record<StudioDiagnostic['severity'], string> = { error: '●', warning: '▲', info: 'ℹ', hint: '·' };

/** Diagnostics list for the open file with a "Fix with agent" hand-off. */
export interface ProblemsPanelProps {
  path: string | null;
  diagnostics: StudioDiagnostic[];
  compact?: boolean;
  /** Reveal a 1-based position in the editor. */
  onReveal?(line: number, column: number): void;
  onFixWithAgent?(): void;
  /** True while the agent hand-off is in flight. */
  busy?: boolean;
}

export function sortDiagnostics(diagnostics: StudioDiagnostic[]): StudioDiagnostic[] {
  return [...diagnostics].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.line - b.line || a.column - b.column);
}

export function ProblemsPanel({ path, diagnostics, compact, onReveal, onFixWithAgent, busy }: ProblemsPanelProps) {
  const rows = sortDiagnostics(diagnostics);
  return <section className="sf-problems" data-compact={compact ? 'true' : undefined} aria-label="Problems">
    <header className="sf-problems-head">
      <span>{rows.length === 0 ? 'No problems' : `${rows.length} ${rows.length === 1 ? 'problem' : 'problems'}`}{path ? <small> · {path.split('/').pop()}</small> : null}</span>
      {onFixWithAgent && <button type="button" className="sf-btn-small" disabled={rows.length === 0 || !path || busy} onClick={onFixWithAgent}>
        <Sparkles size={12} aria-hidden="true" />{busy ? 'Asking…' : 'Fix with agent'}
      </button>}
    </header>
    {rows.length === 0
      ? <p className="sf-problems-empty">{path ? 'The compiler found nothing to fix in this file.' : 'Open a project file to see its problems.'}</p>
      : <ul className="sf-problems-list">
        {rows.map((row, index) => <li key={`${row.line}:${row.column}:${index}`}>
          <button type="button" className={`sf-problem is-${row.severity}`} onClick={() => onReveal?.(row.line, row.column)}>
            <span className="sf-problem-mark" aria-hidden="true">{SEVERITY_MARK[row.severity]}</span>
            <span className="sf-problem-message">{row.message}</span>
            <span className="sf-problem-where">{row.code ? `${row.code} · ` : ''}Ln {row.line}, Col {row.column}</span>
          </button>
        </li>)}
      </ul>}
  </section>;
}
