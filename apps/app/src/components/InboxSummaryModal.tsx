/**
 * Inbox "Details" modal — the expanded, sectioned view of the AI Summary card.
 *
 * Opened from the card's expand button. It runs a SEPARATE, on-demand-only LLM
 * micro-call (`inbox:summarizeDetailed`, never background-warmed) that returns a
 * {@link DetailedInboxDigest}: themed sections of actionable points. The result
 * is cached per scope by the inbox content signature, so reopening the modal
 * while the inbox hasn't changed is free (see `refreshDetailedInboxSummary`).
 *
 * Click-to-spawn: a point that main resolved to a real project (Rule 1 — main
 * mapped the model's project NAME to a validated id; the renderer never trusts a
 * raw model string) carries a `projectId` + `suggestedPrompt` and gets a "Spawn
 * agent" affordance. Spawning is two-step (expand an editable prompt, then
 * confirm) so a dense list can't yield an accidental agent. On success we open
 * the new agent's tab and toast.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  RefreshCw,
  Sparkles,
  Terminal,
  X
} from 'lucide-react';
import type { DetailedInboxPoint, InboxEntry } from '@zana-ai/zcc-domain/product';
import {
  inboxContentSignature,
  refreshDetailedInboxSummary,
  useData,
  useInboxDetailedSummary,
  useUi
} from '../store.js';
import { useDialogFocusTrap } from '../hooks/useDialogFocusTrap.js';

export function InboxSummaryModal({
  scopeProjectId,
  entries,
  onClose
}: {
  scopeProjectId: string | null;
  entries: InboxEntry[];
  onClose: () => void;
}) {
  const scopeKey = scopeProjectId ?? '__all__';
  const item = useInboxDetailedSummary((s) => s.byScope[scopeKey]);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocusTrap(dialogRef, onClose);

  const signature = useMemo(() => inboxContentSignature(entries), [entries]);

  // Fetch on open (cache-checked inside refreshDetailedInboxSummary — a hit is a
  // no-op, so no tokens when the inbox hasn't changed since the last open).
  useEffect(() => {
    if (entries.length === 0) return;
    void refreshDetailedInboxSummary(scopeProjectId, signature);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeProjectId, signature]);

  const loading = item?.loading ?? false;
  const digest = item?.digest ?? null;
  const error = item?.error ?? null;

  const onRegenerate = () => {
    if (loading) return;
    void refreshDetailedInboxSummary(scopeProjectId, signature, true);
  };

  return createPortal(
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="palette inbox-summary-modal"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Detailed inbox summary"
      >
        <div className="inbox-summary-modal-head">
          <span className="inbox-summary-modal-title">
            <Sparkles size={15} className="inbox-ai-card-spark" aria-hidden />
            Inbox summary
          </span>
          <button
            type="button"
            className={`inbox-ai-card-refresh ${loading ? 'spinning' : ''}`}
            onClick={onRegenerate}
            disabled={loading}
            title="Regenerate"
            aria-label="Regenerate detailed summary"
          >
            <RefreshCw size={13} />
          </button>
          <button
            type="button"
            className="inbox-summary-modal-close"
            onClick={onClose}
            title="Close"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="inbox-summary-modal-body">
          {digest ? (
            <>
              {digest.headline && (
                <p className="inbox-summary-modal-headline">{digest.headline}</p>
              )}
              {digest.sections.length === 0 ? (
                <div className="inbox-summary-modal-empty">
                  Nothing notable to break out right now.
                </div>
              ) : (
                digest.sections.map((section, si) => (
                  <section key={si} className="inbox-summary-section">
                    <h4 className="inbox-summary-section-title">{section.title}</h4>
                    <ul className="inbox-summary-points">
                      {section.points.map((point, pi) => (
                        <PointRow key={pi} point={point} onSpawned={onClose} />
                      ))}
                    </ul>
                  </section>
                ))
              )}
            </>
          ) : loading ? (
            <div className="inbox-summary-modal-loading">
              <div className="inbox-ai-skel-line" />
              <div className="inbox-ai-skel-line short" />
              <div className="inbox-ai-skel-line" />
              <div className="inbox-ai-skel-line short" />
            </div>
          ) : (
            <div className="inbox-summary-modal-empty">
              {error === 'failed'
                ? 'Couldn’t generate a detailed summary right now.'
                : entries.length === 0
                  ? 'Nothing in the inbox to summarize.'
                  : 'No summary yet.'}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

const KIND_ICON = {
  done: <CheckCircle2 size={14} className="inbox-ai-bullet-icon done" aria-hidden />,
  attention: <AlertCircle size={14} className="inbox-ai-bullet-icon attention" aria-hidden />,
  question: <HelpCircle size={14} className="inbox-ai-bullet-icon attention" aria-hidden />
} as const;

/**
 * One digest point. When `point.projectId` is set (main resolved + validated it)
 * and a `suggestedPrompt` is present, the row offers a two-step spawn: click
 * "Spawn agent" to reveal an editable prompt, then "Spawn" to open a fresh agent
 * in that project seeded with the (possibly edited) prompt.
 */
function PointRow({ point, onSpawned }: { point: DetailedInboxPoint; onSpawned: () => void }) {
  const projects = useData((s) => s.projects);
  const createTerminal = useData((s) => s.createTerminal);
  const selectTab = useUi((s) => s.selectTab);
  const pushToast = useUi((s) => s.pushToast);

  const project = point.projectId ? projects.find((p) => p.id === point.projectId) ?? null : null;
  const canSpawn = !!project && !!point.suggestedPrompt;

  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState(point.suggestedPrompt ?? '');
  const [busy, setBusy] = useState(false);

  const spawn = async () => {
    if (!project || busy || !prompt.trim()) return;
    setBusy(true);
    try {
      const session = await createTerminal(project.id, 'claude', 80, 24, {
        prompt: prompt.trim()
      });
      if (session) {
        useUi.getState().enterProjectFocus(project.id);
        selectTab(project.id, session.id);
        pushToast(`Agent spawned in ${project.name}`, 'info');
        onSpawned();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="inbox-summary-point">
      <div className="inbox-summary-point-line">
        {KIND_ICON[point.kind]}
        <span className="inbox-summary-point-text">{point.text}</span>
        {canSpawn && !open && (
          <button
            type="button"
            className="inbox-summary-spawn-btn"
            onClick={() => setOpen(true)}
            title={`Spawn an agent in ${project!.name}`}
          >
            <Terminal size={12} />
            <span>Spawn agent</span>
          </button>
        )}
      </div>
      {canSpawn && open && (
        <div className="inbox-summary-spawn-box">
          <div className="inbox-summary-spawn-target">
            <Terminal size={11} aria-hidden />
            <span>
              New agent in <span className="strong">{project!.name}</span>
            </span>
          </div>
          <textarea
            className="inbox-summary-spawn-input"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            aria-label="Prompt for the new agent"
            autoFocus
          />
          <div className="inbox-summary-spawn-actions">
            <button
              type="button"
              className="btn"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => void spawn()}
              disabled={busy || !prompt.trim()}
            >
              {busy ? 'Spawning…' : 'Spawn'}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
