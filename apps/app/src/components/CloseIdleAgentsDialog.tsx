import { useEffect, useState } from 'react';
import { Moon, X } from 'lucide-react';
import type { AgentCard } from './AgentBoard.js';

interface Props {
  /** The at-rest agents this dialog acts on (already filtered by the caller). */
  agents: AgentCard[];
  /**
   * The owning project's name (per-project board). Omit on the cross-project
   * (global) board, where the agents span many projects — the dialog then shows
   * each row's own project and a "across N projects" scope line instead.
   */
  projectName?: string;
  /**
   * Which action this dialog confirms:
   *  - `close` (default): DESTRUCTIVE — terminate the agents. A checkbox offers
   *    to fold their work into one inbox entry AND file a follow-up for anything
   *    left unfinished FIRST (default on); `onConfirm` receives whether the user
   *    opted in.
   *  - `summarize`: READ-ONLY — fold each agent's work into one inbox entry and
   *    leave every agent RUNNING. No checkbox; `onConfirm` is called with `true`
   *    for a uniform shape. This is the "what did they do?" action — it never
   *    closes anything.
   */
  action?: 'summarize' | 'close';
  onClose: () => void;
  /**
   * Confirm. For `close`: terminate the agents, folding a summary + follow-ups
   * first iff `summarize`. For `summarize`: write the digest (the arg is always
   * `true`). Returns once the (async) work kicks off; the dialog closes.
   */
  onConfirm: (summarize: boolean) => void | Promise<void>;
}

/**
 * Confirmation modal for the Agents board's "Summarize" / "Close" actions.
 * Lists the agents involved and — in `close` mode — offers a single choice
 * (fold a work summary + file follow-ups first, or not) before terminating
 * them. In `summarize` mode nothing is closed: the agents are distilled to the
 * inbox and left running, so the choice is replaced by an explanation. Mirrors
 * the structure/markup of {@link AddRemoteProjectDialog} (backdrop + modal +
 * footer) so it inherits the app's modal styling.
 */
export function CloseIdleAgentsDialog({
  agents,
  projectName,
  action = 'close',
  onClose,
  onConfirm
}: Props) {
  const readOnly = action === 'summarize';
  const [summarize, setSummarize] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const n = agents.length;
  // Cross-project (global) board: no single project name, so scope by the
  // distinct projects the agents span and show each row's own project chip.
  const projectCount = new Set(agents.map((c) => c.projectId)).size;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const confirm = async () => {
    setSubmitting(true);
    try {
      // The read-only summarize action always "summarizes", so pass true.
      await onConfirm(readOnly ? true : summarize);
    } finally {
      // The parent unmounts us on confirm, but guard in case it doesn't.
      setSubmitting(false);
    }
  };

  const scope = projectName ? (
    <>
      <strong>{projectName}</strong>
    </>
  ) : (
    <strong>
      {projectCount} {projectCount === 1 ? 'project' : 'projects'}
    </strong>
  );

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal close-idle-modal"
        role="dialog"
        aria-modal="true"
        aria-label={readOnly ? 'Summarize idle agents' : 'Close idle agents'}
      >
        <div className="modal-header">
          <h3>
            {readOnly ? 'Summarize' : 'Close'} {n} {n === 1 ? 'agent' : 'agents'}
          </h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <div className="modal-body">
          <div className="modal-hint">
            {readOnly ? (
              <>
                These idle agents in {scope} will be summarised to your inbox and{' '}
                <strong>left running</strong>.
              </>
            ) : (
              <>
                These at-rest agents in {scope} will be <strong>terminated</strong>. Working and
                blocked agents are left running.
              </>
            )}
          </div>

          <div className="close-idle-list">
            {agents.map((c) => (
              <div key={c.session.id} className="close-idle-row">
                <Moon size={12} aria-hidden="true" />
                <span className="close-idle-title">{c.session.title}</span>
                {/* On the global board show which project each agent belongs to. */}
                {!projectName && <span className="close-idle-project">{c.projectName}</span>}
                {c.triage?.summary && (
                  <span className="close-idle-gloss">{c.triage.summary}</span>
                )}
              </div>
            ))}
          </div>

          {readOnly ? (
            <div className="close-idle-summarize close-idle-note">
              <span>
                Each agent’s “what it did / what’s left” is folded into one inbox entry.
                <small>Nothing is closed. Runs one quick claude call per agent.</small>
              </span>
            </div>
          ) : (
            <label className="close-idle-summarize">
              <input
                type="checkbox"
                checked={summarize}
                onChange={(e) => setSummarize(e.target.checked)}
              />
              <span>
                Summarise their work &amp; file follow-ups first
                <small>
                  Folds each agent’s “what it did / what’s left” into one inbox entry and files a
                  follow-up for anything unfinished. Runs one quick claude call per agent.
                </small>
              </span>
            </label>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button className="btn primary" onClick={confirm} disabled={submitting}>
            {readOnly
              ? submitting
                ? 'Summarizing…'
                : 'Summarize'
              : submitting
                ? summarize
                  ? 'Summarizing…'
                  : 'Closing…'
                : summarize
                  ? 'Summarize & close'
                  : 'Close agents'}
          </button>
        </div>
      </div>
    </div>
  );
}
