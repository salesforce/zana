import { useState } from 'react';
import {
  PackageCheck,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  Download,
  Copy,
  Check,
  RefreshCw,
  X
} from 'lucide-react';
import { useSetup, useUi, hasMissingSetup } from '../store';
import type { DependencyState } from '@shared/types';

/**
 * First-run setup checklist — the visible half of the dependency doctor
 * (src/main/dependency-doctor.ts). It shows, in one nicely-laid-out card, the
 * state of every companion piece the installer normally sets up (the Claude
 * Code CLI, the Zana MCP server + plugins, and the bundled
 * extensions), and lets the user:
 *   - "Install missing" → run the auto-installable steps (npm + claude CLI),
 *     with per-step progress streamed under each row;
 *   - copy the exact command for the pieces we can't install for them
 *     (the manual Claude Code installation);
 *   - re-check after they've installed something out-of-band.
 *
 * Auto-opens once on first launch when something is missing (gated on
 * AppConfig.setupDismissed in the store init); re-openable from Settings.
 * Dismissing flips `setupDismissed` so it won't auto-open again.
 */

function PhaseIcon({ dep }: { dep: DependencyState }) {
  switch (dep.phase) {
    case 'present':
    case 'installed':
      return <CheckCircle2 size={17} className="setup-row-icon setup-row-icon--ok" aria-label="installed" />;
    case 'installing':
    case 'checking':
      return <Loader2 size={17} className="setup-row-icon setup-row-icon--spin" aria-label="working" />;
    case 'failed':
      return <XCircle size={17} className="setup-row-icon setup-row-icon--err" aria-label="failed" />;
    case 'missing':
    default:
      return (
        <AlertTriangle size={17} className="setup-row-icon setup-row-icon--warn" aria-label="missing" />
      );
  }
}

function statusLabel(dep: DependencyState): string {
  switch (dep.phase) {
    case 'present':
      return dep.note ?? 'Installed';
    case 'installed':
      return dep.note ?? 'Installed';
    case 'checking':
      return 'Checking…';
    case 'installing':
      return 'Installing…';
    case 'failed':
      return dep.note ? `Failed — ${dep.note}` : 'Failed';
    case 'missing':
    default:
      return dep.kind === 'manual' ? 'Not installed' : 'Missing — can install';
  }
}

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="setup-copy"
      title="Copy command"
      onClick={() => {
        void navigator.clipboard.writeText(command).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      <code>{command}</code>
    </button>
  );
}

function SetupRow({ dep, progress }: { dep: DependencyState; progress?: string }) {
  const needsManual =
    dep.kind === 'manual' && (dep.phase === 'missing' || dep.phase === 'failed') && dep.manualCommand;
  return (
    <li className="setup-row">
      <PhaseIcon dep={dep} />
      <div className="setup-row-main">
        <div className="setup-row-head">
          <span className="setup-row-label">{dep.label}</span>
          <span className={`setup-row-status setup-row-status--${dep.phase}`}>{statusLabel(dep)}</span>
        </div>
        <p className="setup-row-detail">{dep.detail}</p>
        {dep.phase === 'installing' && progress && (
          <p className="setup-row-progress">{progress}</p>
        )}
        {needsManual && (
          <div className="setup-row-manual">
            <span className="setup-row-manual-hint">Install it yourself:</span>
            <CopyCommand command={dep.manualCommand!} />
          </div>
        )}
      </div>
    </li>
  );
}

interface Props {
  onClose: () => void;
}

function SetupChecklist({ onClose }: Props) {
  const status = useSetup((s) => s.status);
  const progress = useSetup((s) => s.progress);

  const items = status.items;
  const missing = hasMissingSetup(status);
  const installable = items.some(
    (i) => i.kind === 'installable' && (i.phase === 'missing' || i.phase === 'failed')
  );
  const allGood = items.length > 0 && !missing && !status.busy;

  return (
    <div className="palette-backdrop setup-backdrop" onMouseDown={onClose}>
      <div
        className="setup-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button className="setup-dismiss" type="button" onClick={onClose} aria-label="Dismiss">
          <X size={14} />
        </button>

        <div className="setup-header">
          <div className="setup-icon">
            <PackageCheck size={24} strokeWidth={1.75} />
          </div>
          <div>
            <h3 id="setup-title" className="setup-title">
              Finish setting up
            </h3>
            <p className="setup-subtitle">
              {allGood
                ? 'Everything Zana needs is installed.'
                : 'These companion pieces make agents and Zana work. Install the missing ones below.'}
            </p>
          </div>
        </div>

        <ul className="setup-list">
          {items.length === 0 ? (
            <li className="setup-empty">
              <Loader2 size={15} className="setup-row-icon--spin" /> Checking your setup…
            </li>
          ) : (
            items.map((dep) => (
              <SetupRow key={dep.id} dep={dep} progress={progress[dep.id]} />
            ))
          )}
        </ul>

        <div className="setup-footer">
          <button
            type="button"
            className="btn ghost"
            onClick={() => void window.cc.deps.check()}
            disabled={status.busy}
            title="Re-check after installing something yourself"
          >
            <RefreshCw size={14} className={status.busy ? 'setup-row-icon--spin' : undefined} />
            Re-check
          </button>
          <span className="grow" />
          {allGood ? (
            <button type="button" className="btn" onClick={onClose}>
              <Check size={14} /> Done
            </button>
          ) : (
            <>
              <button type="button" className="btn ghost" onClick={onClose}>
                Later
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void window.cc.deps.install()}
                disabled={status.busy || !installable}
                title={
                  installable
                    ? 'Install the pieces we can set up automatically'
                    : 'Nothing left to auto-install — the rest need a manual command above'
                }
              >
                {status.busy ? (
                  <>
                    <Loader2 size={14} className="setup-row-icon--spin" /> Installing…
                  </>
                ) : (
                  <>
                    <Download size={14} /> Install missing
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Mount point + lifecycle for the setup checklist. Closing it (Later / Done /
 * backdrop) persists `setupDismissed` so it never auto-opens again — re-open it
 * from Settings, which sets `setupOpen` without clearing the flag. Auto-open is
 * decided in the store's deps:onStatus subscription, not here.
 */
export function SetupChecklistHost() {
  const open = useUi((s) => s.setupOpen);
  const close = () => {
    useUi.getState().setSetupOpen(false);
    void window.cc.deps.dismiss();
  };
  if (!open) return null;
  return <SetupChecklist onClose={close} />;
}
