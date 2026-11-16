import { useState } from 'react';
import {
  formatSquadPlanFinding,
  formatSquadPlanFindingProblem,
  squadFindingSeverityLabel,
  type SquadLaunchPrefill,
  type SquadPlanFinding
} from '@zana-ai/zcc-domain/squad-proposal';
import { product } from '../lib/product-client.js';
import { copyTextOrFail } from '../lib/copy-text.js';

type PlanDisplay = Pick<SquadLaunchPrefill, 'planFindings' | 'planFindingsHidden' | 'planBindings' | 'planBindingsHidden' | 'planSummary'>;
/** What a re-check replaces: every plan field, including the ones that are now absent. */
export type PlanRecheck = PlanDisplay & Pick<SquadLaunchPrefill, 'planStepCount'>;

const SEVERITIES: SquadPlanFinding['severity'][] = ['blocking', 'warning', 'repair'];

/** True while the prepared plan still has a Must fix. Advisory: main re-runs the hard check at launch. */
export function planHasMustFix(prefill: PlanDisplay | undefined): boolean {
  return Boolean(prefill?.planFindings?.some((finding) => finding.severity === 'blocking'));
}

/**
 * "Review plan" disclosure in the Squad composer: the one-line summary, the step-to-member binding table, and
 * each finding as one plain sentence (Must fix, Check, Fixed for you). Renders nothing for a plan with no check data.
 */
export function PlanReviewDisclosure({ prefill, proposalId, proposerTitle, planFiles, onRechecked, onSent }: {
  prefill: PlanDisplay;
  proposalId?: string;
  proposerTitle?: string;
  /** Names of the plan files in the Project that Re-check reads again. */
  planFiles?: string[];
  onRechecked?: (next: PlanRecheck) => void;
  /** The request reached the conversation; the parent closes the dialog and tells the user to wait. */
  onSent?: () => void;
}) {
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [hint, setHint] = useState<'copy' | 'send' | 'recheck' | null>(null);
  const [busy, setBusy] = useState<'send' | 'recheck' | null>(null);
  const findings = prefill.planFindings ?? [];
  const bindings = prefill.planBindings ?? [];
  if (!prefill.planSummary && !findings.length && !bindings.length) return null;
  const mustFix = planHasMustFix(prefill);
  const blocking = findings.filter((finding) => finding.severity === 'blocking');
  const who = proposerTitle ? `the agent “${proposerTitle}”` : 'the agent that prepared this launch';
  const fixRequest = [
    `The Squad launch you prepared cannot start yet. ${blocking.length === 1 ? 'One problem' : `${blocking.length} problems`} in the plan:`,
    ...blocking.map((finding) => `- ${formatSquadPlanFindingProblem(finding)}`),
    '',
    'Please revise the plan (save the fix as a copy, leave my original file alone) and prepare the Squad launch again.'
  ].join('\n');
  const fileList = planFiles?.length ? planFiles.join(', ') : null;
  const hints = {
    copy: `Copies a request that lists the problems above. Paste it into ${who} yourself.`,
    send: `Sends the problems above to ${who}. It revises the plan and prepares a new launch in your Inbox. This dialog closes.`,
    recheck: fileList
      ? `Reads ${fileList} from disk again. Fix the file in your editor first, then press this. Launch turns on when no Must fix is left.`
      : 'Reads the plan files from disk again. Fix the file in your editor first, then press this. A plan you pasted or attached cannot be re-read.'
  } as const;
  // Pointing at another button clears the last result, so "Copied" never sits under the wrong button's help.
  const showHint = (key: keyof typeof hints) => {
    if (key !== hint) setStatus(null);
    setHint(key);
  };
  const hintProps = (key: keyof typeof hints) => ({
    onMouseEnter: () => showHint(key), onFocus: () => showHint(key),
    onMouseLeave: () => setHint(null), onBlur: () => setHint(null),
    'aria-describedby': 'plan-action-hint'
  });
  const copy = async () => {
    try {
      await copyTextOrFail(fixRequest);
      setStatus({ tone: 'ok', text: `Copied. Paste it into ${who}.` });
    } catch {
      setStatus({ tone: 'error', text: 'Could not copy to the clipboard. Use Send instead.' });
    }
  };
  const send = async () => {
    if (!proposalId) return;
    setBusy('send');
    const result = await product.teams.messageProposer(proposalId).catch(() => null);
    setBusy(null);
    if (result?.ok) {
      onSent?.();
      return;
    }
    setStatus({ tone: 'error', text: result?.message ?? 'Could not send the request. Copy it instead.' });
  };
  const recheck = async () => {
    if (!proposalId) return;
    setBusy('recheck');
    const result = await product.teams.recheckProposalPlan(proposalId).catch(() => null);
    setBusy(null);
    if (!result?.ok) {
      setStatus({ tone: 'error', text: result?.message ?? 'Could not re-check the plan.' });
      return;
    }
    onRechecked?.(result.value);
    const left = (result.value.planFindings ?? []).filter((finding) => finding.severity === 'blocking').length;
    setStatus(left
      ? { tone: 'error', text: `Re-checked: ${left} Must fix ${left === 1 ? 'remains' : 'remain'}.` }
      : { tone: 'ok', text: 'Re-checked: nothing left to fix. You can launch.' });
  };
  return (
    <details className="team-composer-plan-review" data-testid="team-composer-plan-review" data-must-fix={mustFix ? 'true' : undefined} open={mustFix}>
      <summary>{mustFix
        ? `Can't launch yet: ${blocking.length} Must fix`
        : `Review plan${prefill.planSummary ? `: ${prefill.planSummary}` : ''}`}</summary>
      {SEVERITIES.map((severity) => {
        const group = findings.filter((finding) => finding.severity === severity);
        if (!group.length) return null;
        return (
          <section key={severity} data-testid={`plan-findings-${severity}`} data-severity={severity}>
            <h4>{squadFindingSeverityLabel(severity)}</h4>
            <ul>
              {group.map((finding, index) => <li key={`${finding.stepId ?? 'plan'}-${finding.requirement}-${index}`}>{severity === 'blocking' ? formatSquadPlanFindingProblem(finding) : formatSquadPlanFinding(finding)}</li>)}
            </ul>
          </section>
        );
      })}
      {prefill.planFindingsHidden ? <p>and {prefill.planFindingsHidden} more</p> : null}
      {bindings.length ? (
        <table data-testid="plan-bindings">
          <caption>Who runs each step</caption>
          <thead><tr><th scope="col">Step</th><th scope="col">Member</th></tr></thead>
          <tbody>
            {bindings.map((binding) => (
              <tr key={binding.stepId}>
                <th scope="row">{binding.stepId}</th>
                <td>{binding.unbound ? 'No member can run this step' : binding.label?.trim() || binding.personaId || 'Chosen when it starts'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {prefill.planBindingsHidden ? <p>and {prefill.planBindingsHidden} more</p> : null}
      {mustFix && proposalId ? (
        <div className="team-composer-plan-actions" data-testid="plan-fix-actions">
          <h4>How to fix it</h4>
                    <div className="team-composer-plan-action-row">
            <button type="button" className="btn" data-testid="plan-copy-fix" {...hintProps('copy')} onClick={() => void copy()}>Copy fix request</button>
            <button type="button" className="btn" data-testid="plan-send-fix" {...hintProps('send')} disabled={busy !== null} onClick={() => void send()}>
              {busy === 'send' ? 'Sending…' : 'Send to agent'}
            </button>
            <button type="button" className="btn" data-testid="plan-recheck" {...hintProps('recheck')} disabled={busy !== null} onClick={() => void recheck()}>
              {busy === 'recheck' ? 'Checking…' : 'Re-check plan'}
            </button>
          </div>
          <p id="plan-action-hint" className="team-composer-plan-hint" data-testid="plan-action-hint">{hint ? hints[hint] : `Send the problems to ${who}, or fix ${fileList ?? 'the plan file'} yourself and re-check. Point at a button to see what it does.`}</p>
              <div className="team-composer-plan-other" data-testid="plan-other-options">
            <h4>Other options</h4>
            <p>To use a different Squad or let the coordinator plan, close this and ask {who} to prepare the launch that way.</p>
          </div>
        </div>
      ) : null}
      {status ? <p role="status" data-testid="plan-action-status" className={status.tone === 'error' ? 'thread-command-error' : undefined}>{status.text}</p> : null}
    </details>
  );
}
