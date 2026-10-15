import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { callPluginRpc, experimental_requestApproval } from '@zana-ai/zcc-plugin-sdk/app';
import { Circle, CircleAlert, CircleCheck, Cloud, CloudUpload, RefreshCw } from 'lucide-react';
import { comparableText, diffStats, foldDiff, lineDiff } from '../../../lib/line-diff.js';
import { RELEASE_RPC, type ReleaseAction, type ReleasePrepared, type ReleaseState, type ReleaseVersion, type ReleaseVersionSource } from '../../../lib/release-contract.js';
import { CONTEXT_CHANGED_EVENT } from '../context-sync.js';
import type { CompileState } from './compile-result.js';

/**
 * The Release tool: Save, Compile and Publish in one lane, then the org's
 * versions with Activate and Deactivate. Each org step asks the host for a
 * signed approval; the server rebuilds what it signs from disk and the org.
 * View opens one version's source read-only, next to a diff against the draft.
 */
export interface ReleasePaneProps {
  pluginId: string;
  projectId?: string;
  path: string | null;
  visible: boolean;
  /** Unsaved edits block Publish: the approval signs the file on disk. */
  dirty: boolean;
  /** The editor's file SHA; a new one refreshes the lane. */
  sha256?: string | null;
  /** The editor's text, unsaved edits included. A version diffs against it. */
  source?: string;
  compile: CompileState | null;
  /** The compile answer is for an older version of the file. */
  compileStale: boolean;
  onSave(): void;
  onCompile(): void;
  /** Hands the step to an agent in a thread, where the guardrail confirms it. */
  onAskAgent?(prompt: string): void;
  /** Injected in tests. */
  call?: typeof callPluginRpc;
  requestApproval?: typeof experimental_requestApproval;
}

export type Message = { tone: 'ok' | 'muted' | 'error'; text: string; ask?: string };
type Reply<T> = { ok: true; data: T; summary?: string } | { ok: false; code?: string; error?: string };

const STYLES = `
.sf-rl { display: flex; flex: 1; flex-direction: column; gap: 16px; padding: 16px; box-sizing: border-box; color: var(--sf-text); font-size: 12px; line-height: 1.5; min-width: 0; min-height: 0; overflow: auto; }
.sf-rl-head { display: flex; align-items: flex-start; gap: 8px; }
.sf-rl-heading { flex: 1; min-width: 0; }
.sf-rl-head h2 { margin: 0 0 4px; font-size: 14px; font-weight: 600; }
.sf-rl-org { display: flex; align-items: center; gap: 5px; color: var(--sf-muted); font-size: 11px; overflow-wrap: anywhere; }
.sf-rl-org svg { flex: none; }
.sf-rl-org.is-risky { color: var(--sf-danger); }
.sf-rl-spacer { flex: 1; }
.sf-rl-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 28px; flex: none; border: 1px solid var(--sf-border); background: transparent; color: var(--sf-text); border-radius: 6px; padding: 3px 10px; font: inherit; cursor: pointer; white-space: nowrap; }
.sf-rl-btn:hover:not(:disabled) { background: var(--sf-elevated); }
.sf-rl-btn.is-primary { border-color: var(--sf-accent); background: var(--sf-accent); color: var(--sf-on-accent); font-weight: 600; }
.sf-rl-btn.is-primary:hover:not(:disabled) { background: color-mix(in srgb, var(--sf-accent) 85%, var(--sf-text)); }
.sf-rl-btn.is-danger { border-color: var(--sf-danger); color: var(--sf-danger); }
.sf-rl-btn.is-primary.is-danger { background: var(--sf-danger); color: var(--sf-on-accent); }
.sf-rl-btn.is-icon { width: 28px; padding: 0; border-color: transparent; color: var(--sf-muted); }
.sf-rl-btn:disabled { opacity: 0.5; cursor: default; }
.sf-rl-draft { display: flex; flex-direction: column; gap: 12px; min-width: 0; padding: 12px; border: 1px solid var(--sf-border); border-radius: 10px; background: var(--sf-surface); }
.sf-rl-draft-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 600; }
.sf-rl-caption { margin: 0; color: var(--sf-muted); font-size: 11px; overflow-wrap: anywhere; }
.sf-rl-checks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.sf-rl-check { display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 28px; color: var(--sf-muted); }
.sf-rl-check > svg { flex: none; }
.sf-rl-check.is-done > svg { color: var(--sf-success); }
.sf-rl-check.is-failed > svg { color: var(--sf-danger); }
.sf-rl-check-note { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.sf-rl-publish { min-height: 34px; width: 100%; }
.sf-rl-section-head { display: flex; align-items: center; gap: 8px; border-top: 1px solid var(--sf-border); padding-top: 16px; }
.sf-rl-section { font-size: 12px; font-weight: 600; margin: 0; }
.sf-rl-count { color: var(--sf-muted); font-size: 11px; }
.sf-rl-versions { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.sf-rl-version { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; border-bottom: 1px solid var(--sf-border); padding: 10px 0; }
.sf-rl-version:first-child { padding-top: 0; }
.sf-rl-version-info { display: flex; flex: 1 1 180px; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
.sf-rl-version-actions { display: flex; align-items: center; gap: 6px; margin-left: auto; }
.sf-rl-vn { font-weight: 600; min-width: 28px; }
.sf-rl-badge { border-radius: 4px; padding: 1px 5px; border: 1px solid var(--sf-border); color: var(--sf-muted); font-size: 10px; white-space: nowrap; }
.sf-rl-badge.is-active { border-color: transparent; background: var(--sf-soft); color: var(--sf-accent); }
.sf-rl-badge.is-passed { border-color: var(--sf-success); color: var(--sf-success); }
.sf-rl-badge.is-failed { border-color: var(--sf-danger); color: var(--sf-danger); }
.sf-rl-date { flex-basis: 100%; color: var(--sf-muted); font-size: 11px; }
.sf-rl-message { border: 1px solid var(--sf-border); border-radius: 8px; padding: 10px 12px; background: var(--sf-elevated); display: flex; flex-wrap: wrap; gap: 8px; align-items: center; overflow-wrap: anywhere; }
.sf-rl-message > span { flex: 1 1 160px; min-width: 0; }
.sf-rl-message.is-error { color: var(--sf-danger); border-color: color-mix(in srgb, var(--sf-danger) 30%, var(--sf-border)); background: color-mix(in srgb, var(--sf-danger) 5%, var(--sf-surface)); }
.sf-rl-message.is-ok { color: var(--sf-success); }
.sf-rl-message.is-muted { color: var(--sf-muted); }
.sf-rl-empty { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; color: var(--sf-muted); padding: 12px; border: 1px dashed var(--sf-border); border-radius: 8px; overflow-wrap: anywhere; }
.sf-rl-empty strong { font-weight: 500; color: var(--sf-text); }
.sf-rl-empty p { margin: 0; }
.sf-rl-viewer { border: 1px solid var(--sf-border); border-radius: 8px; display: flex; flex-direction: column; min-height: 0; }
.sf-rl-viewer-head { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-bottom: 1px solid var(--sf-border); flex-wrap: wrap; }
.sf-rl-viewer-title { font-weight: 600; }
.sf-rl-toggle { display: inline-flex; border: 1px solid var(--sf-border); border-radius: 6px; overflow: hidden; }
.sf-rl-toggle button { border: 0; background: transparent; color: var(--sf-muted); padding: 2px 8px; font: inherit; cursor: pointer; }
.sf-rl-toggle button[aria-pressed="true"] { background: var(--sf-elevated); color: var(--sf-text); }
.sf-rl-toggle button:disabled { opacity: 0.5; cursor: default; }
.sf-rl-code { margin: 0; padding: 6px 0; max-height: 420px; overflow: auto; font: 11.5px/1.5 var(--sf-mono, ui-monospace, SFMono-Regular, Menlo, monospace); }
.sf-rl-line { display: flex; white-space: pre; padding-right: 8px; }
.sf-rl-line.is-add { background: color-mix(in srgb, var(--sf-success) 14%, transparent); }
.sf-rl-line.is-del { background: color-mix(in srgb, var(--sf-danger) 14%, transparent); }
.sf-rl-line.is-gap { color: var(--sf-muted); font-style: italic; }
.sf-rl-ln { flex: 0 0 auto; min-width: 40px; padding: 0 8px; text-align: right; color: var(--sf-muted); user-select: none; }
.sf-rl-diff-note { padding: 6px 8px; color: var(--sf-muted); border-bottom: 1px solid var(--sf-border); }
`;

const shortDate = (value: string | number | null | undefined) => {
  if (value === null || value === undefined) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const ASK: Record<Exclude<ReleaseAction, 'org.read'>, (version?: number) => string> = {
  'agent.publish': () => 'Review and publish this Salesforce Agentforce draft to the selected project org as an inactive version. Diagnose and compile it first, show any issues and use sf_agent lifecycle.publish with the normal confirmation. Do not activate.',
  'agent.activate': version => `Activate version ${version} of this Salesforce Agentforce agent on the selected project org. Check its eval evidence first and use sf_agent lifecycle.activate with versionNumber ${version} and the normal confirmation.`,
  'agent.deactivate': () => 'Deactivate the active version of this Salesforce Agentforce agent on the selected project org. Use sf_agent lifecycle.deactivate with the normal confirmation.'
};

/** What to say when the host did not sign an approval. Shared with the Tests pane. */
export function declined(reason: 'cancelled' | 'unavailable' | 'busy' | 'invalid', ask?: string): Message {
  switch (reason) {
    case 'unavailable': return { tone: 'error', text: 'Approvals need the Zana desktop app. Ask the agent in a thread to do this instead.', ...(ask ? { ask } : {}) };
    case 'busy': return { tone: 'error', text: 'Another approval is open in this window. Finish it first.' };
    case 'invalid': return { tone: 'error', text: 'Zana could not show this approval.' };
    default: return { tone: 'muted', text: 'Cancelled. Nothing changed.' };
  }
}

const MARK = { add: '+', del: '−', same: ' ' } as const;

/** One version's source, or its line diff against the draft, read-only. */
function VersionViewer(props: { version: ReleaseVersionSource; draft?: string; dirty: boolean; onClose(): void }) {
  const { version, draft, dirty, onClose } = props;
  const [mode, setMode] = useState<'source' | 'diff'>('source');
  // A retrieved file may differ from the draft only in line endings; that is not a change worth showing.
  const content = useMemo(() => comparableText(version.content), [version.content]);
  const diff = useMemo(() => mode === 'diff' && draft !== undefined ? lineDiff(content, comparableText(draft)) : null, [content, draft, mode]);
  const stats = diff ? diffStats(diff) : null;
  const draftLabel = dirty ? 'your draft (unsaved edits included)' : 'your draft';
  return <section className="sf-rl-viewer" aria-label={`v${version.versionNumber} source`} data-testid="release-version-viewer">
    <div className="sf-rl-viewer-head">
      <span className="sf-rl-viewer-title">v{version.versionNumber}</span>
      {version.active && <span className="sf-rl-badge is-active">Active</span>}
      <span className="sf-rl-date" title="The authoring bundle this source came from">{version.fullName} · Read-only</span>
      <span className="sf-rl-spacer" />
      <span className="sf-rl-toggle" role="group" aria-label="Show">
        <button type="button" aria-pressed={mode === 'source'} onClick={() => setMode('source')}>Source</button>
        <button type="button" aria-pressed={mode === 'diff'} disabled={draft === undefined} onClick={() => setMode('diff')}>Diff with draft</button>
      </span>
      <button type="button" className="sf-rl-btn" onClick={onClose}>Close</button>
    </div>
    {mode === 'source'
      ? <pre className="sf-rl-code" data-testid="release-version-source">{content.split('\n').map((text, index) =>
        <span key={index} className="sf-rl-line"><span className="sf-rl-ln">{index + 1}</span>{text}</span>)}</pre>
      : !diff
        ? <div className="sf-rl-diff-note" role="status">These versions differ in too many lines to diff here.</div>
        : <>
          <div className="sf-rl-diff-note" role="status" data-testid="release-version-diff-stats">
            {stats!.added || stats!.removed ? `${stats!.added} added and ${stats!.removed} removed in ${draftLabel}, against v${version.versionNumber}.` : `${draftLabel[0]!.toUpperCase()}${draftLabel.slice(1)} matches v${version.versionNumber}.`}
          </div>
          <pre className="sf-rl-code" data-testid="release-version-diff">{foldDiff(diff).map((hunk, index) => hunk.type === 'gap'
            ? <span key={index} className="sf-rl-line is-gap"><span className="sf-rl-ln" />⋯ {hunk.count} unchanged line{hunk.count === 1 ? '' : 's'}</span>
            : hunk.lines.map((line, row) => <span key={`${index}:${row}`} className={`sf-rl-line${line.type === 'same' ? '' : ` is-${line.type}`}`}>
              <span className="sf-rl-ln">{MARK[line.type]}</span>{line.text}</span>))}</pre>
        </>}
  </section>;
}

function evidenceBadge(version: ReleaseVersion) {
  if (!version.evidence) return <span className="sf-rl-badge">No eval</span>;
  return version.evidence.passed
    ? <span className="sf-rl-badge is-passed" title={`Eval passed ${shortDate(version.evidence.at)}`}>Eval passed</span>
    : <span className="sf-rl-badge is-failed" title={`Eval failed ${shortDate(version.evidence.at)}`}>Eval failed</span>;
}

export function ReleasePane(props: ReleasePaneProps) {
  const { pluginId, projectId, path, visible, dirty, sha256, source, compile, compileStale, onSave, onCompile, onAskAgent } = props;
  const call = props.call ?? callPluginRpc;
  const requestApproval = props.requestApproval ?? experimental_requestApproval;
  const [state, setState] = useState<ReleaseState | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [opened, setOpened] = useState<ReleaseVersionSource | null>(null);
  const [opening, setOpening] = useState<number | null>(null);
  const [orgChange, setOrgChange] = useState(0);
  const sequence = useRef(0);
  const viewSequence = useRef(0);
  /** Bumps when the file or the org changes, so a step that ends later stays quiet. */
  const scope = useRef(0);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const args = useCallback((extra: Record<string, unknown> = {}) => ({ ...(projectId ? { projectId } : {}), path, ...extra }), [path, projectId]);

  const refresh = useCallback(async () => {
    const seq = ++sequence.current;
    if (!path) { setState(null); return; }
    setLoading(true);
    try {
      const reply = await call(pluginId, RELEASE_RPC.state, args()) as Reply<ReleaseState> | null;
      if (!alive.current || seq !== sequence.current) return;
      if (reply?.ok && reply.data) { setState(reply.data); setLoadError(null); }
      else { setState(null); setLoadError((reply && !reply.ok && reply.error) || 'Could not read the release state.'); }
    } catch (error) {
      if (alive.current && seq === sequence.current) { setState(null); setLoadError(error instanceof Error ? error.message : String(error)); }
    } finally {
      if (alive.current && seq === sequence.current) setLoading(false);
    }
  }, [args, call, path, pluginId]);

  const reset = useCallback(() => {
    scope.current += 1;
    sequence.current += 1;
    viewSequence.current += 1;
    setLoading(false);
    setState(null);
    setBusy(null);
    setMessage(null);
    setLoadError(null);
    setOpened(null);
    setOpening(null);
  }, []);
  useEffect(() => { reset(); }, [path, reset]);
  useEffect(() => {
    const changed = (event: Event) => {
      const id = (event as CustomEvent<{ projectId?: string | null }>).detail?.projectId;
      if (id && id !== projectId) return;
      reset();
      setState(null);
      setOrgChange(value => value + 1);
    };
    window.addEventListener(CONTEXT_CHANGED_EVENT, changed);
    return () => window.removeEventListener(CONTEXT_CHANGED_EVENT, changed);
  }, [projectId, reset]);
  useEffect(() => { if (visible) void refresh(); }, [visible, refresh, sha256, orgChange]);

  const step = useCallback(async (action: ReleaseAction, extra: { versionNumber?: number } = {}) => {
    const key = `${action}:${extra.versionNumber ?? ''}`;
    const ask = action === 'org.read' ? undefined : ASK[action](extra.versionNumber);
    const at = scope.current;
    const live = () => alive.current && at === scope.current;
    setBusy(key);
    setMessage(null);
    try {
      const prepared = await call(pluginId, RELEASE_RPC.prepare, args({ action, ...extra })) as Reply<ReleasePrepared> | null;
      if (!live()) return;
      if (!prepared?.ok) { if (live()) setMessage({ tone: 'error', text: prepared?.error || 'Could not prepare this step.' }); return; }
      const answer = await requestApproval(pluginId, prepared.data.request);
      if (!live()) return;
      if (!answer.approved) { setMessage(declined(answer.reason, ask)); return; }
      const result = await call(pluginId, RELEASE_RPC.run, args({ action, ...extra, token: answer.token })) as { ok?: boolean; summary?: string; error?: string } | null;
      // Another file or org is showing now; its own refresh already ran.
      if (!live()) return;
      setMessage(result?.ok ? { tone: 'ok', text: result.summary || 'Done.' } : { tone: 'error', text: result?.error || 'The step failed.' });
      await refresh();
    } catch (error) {
      if (live()) setMessage({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      if (live()) setBusy(null);
    }
  }, [args, call, pluginId, refresh, requestApproval]);

  const view = useCallback(async (versionNumber: number) => {
    const seq = ++viewSequence.current;
    setOpening(versionNumber);
    setMessage(null);
    try {
      const reply = await call(pluginId, RELEASE_RPC.versionSource, args({ versionNumber })) as Reply<ReleaseVersionSource> | null;
      if (!alive.current || seq !== viewSequence.current) return;
      if (reply?.ok && reply.data) setOpened(reply.data);
      else setMessage({ tone: 'error', text: (reply && !reply.ok && reply.error) || `Could not open v${versionNumber}.` });
    } catch (error) {
      if (alive.current && seq === viewSequence.current) setMessage({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      if (alive.current && seq === viewSequence.current) setOpening(null);
    }
  }, [args, call, pluginId]);

  const closeViewer = useCallback(() => {
    viewSequence.current += 1;
    setOpened(null);
    setOpening(null);
  }, []);

  if (!path) {
    return <section className="sf-rl" aria-label="Release" data-testid="studio-release-pane"><style>{STYLES}</style>
      <div className="sf-rl-empty">Open an agent file to publish it and manage its versions.</div>
    </section>;
  }

  const risky = state ? state.org.kind === 'production' || state.org.kind === 'unknown' : false;
  const lastPublish = state?.agent.lastPublish ?? null;
  const unchanged = Boolean(lastPublish && state && lastPublish.revision === state.agent.revision && !dirty);
  const compileDone = compile?.status === 'passed' && !compileStale;
  const compileFailed = compile?.status === 'failed' && !compileStale;
  const publishBlocked = dirty ? 'Save your changes first.' : state?.agent.versioned ? 'Retrieved versions cannot be published. Create a local draft from it first.' : null;
  const active = state?.versions.find(row => row.active) ?? null;
  const name = state?.agent.apiName ?? path.split('/').pop()?.replace(/\.agent$/, '') ?? 'Current draft';
  const SaveIcon = dirty ? Circle : CircleCheck;
  const CompileIcon = compileDone ? CircleCheck : compileFailed ? CircleAlert : Circle;

  return (
    <section className="sf-rl" aria-label="Release" data-testid="studio-release-pane">
      <style>{STYLES}</style>
      <div className="sf-rl-head">
        <div className="sf-rl-heading">
          <h2>Publish agent</h2>
          {state && <span className={`sf-rl-org${risky ? ' is-risky' : ''}`} data-testid="release-org"><Cloud size={13} aria-hidden="true" />{state.org.alias} ({state.org.kind})</span>}
          {loading && !state && <span className="sf-rl-caption" role="status">Loading release details…</span>}
        </div>
        <button type="button" className="sf-rl-btn is-icon" onClick={() => void refresh()} disabled={loading} aria-label="Refresh release" title="Refresh release"><RefreshCw size={14} aria-hidden="true" /></button>
      </div>
      <div className="sf-rl-draft">
        <div>
          <p className="sf-rl-caption">Current draft</p>
          <div className="sf-rl-draft-name" title={name}>{name}</div>
        </div>
        <ul className="sf-rl-checks" aria-label="Draft status">
          <li className={`sf-rl-check${dirty ? '' : ' is-done'}`}>
            <SaveIcon size={14} aria-hidden="true" />
            <span className="sf-rl-check-note">{dirty ? 'Unsaved changes.' : 'Saved to disk.'}</span>
            {dirty && <button type="button" className="sf-rl-btn" onClick={onSave}>Save</button>}
          </li>
          <li className={`sf-rl-check${compileDone ? ' is-done' : compileFailed ? ' is-failed' : ''}`}>
            <CompileIcon size={14} aria-hidden="true" />
            <span className="sf-rl-check-note">
              {compile?.status === 'running' ? 'Compiling…' : compileDone ? 'Compiled.' : compileFailed ? 'Failed. See Problems.' : compile ? 'Out of date.' : 'Not compiled yet.'}
            </span>
            <button type="button" className="sf-rl-btn" onClick={onCompile} disabled={compile?.status === 'running'}>Compile</button>
          </li>
        </ul>
        {lastPublish && <p className="sf-rl-caption">{unchanged ? `Published ${shortDate(lastPublish.at)}. No changes since.` : `Changed since the last publish (${shortDate(lastPublish.at)}).`}</p>}
        {publishBlocked && <p className="sf-rl-caption">{publishBlocked}</p>}
        <button type="button" className={`sf-rl-btn sf-rl-publish is-primary${risky ? ' is-danger' : ''}`} disabled={Boolean(publishBlocked) || !state || busy !== null || compile?.status === 'running'}
          title={publishBlocked ?? undefined} onClick={() => void step('agent.publish')}><CloudUpload size={15} aria-hidden="true" />{busy === 'agent.publish:' ? 'Publishing…' : 'Publish…'}</button>
        <p className="sf-rl-caption">Uploads a new inactive version. Your draft is compiled before publishing; the active version keeps serving users.</p>
      </div>
      {loadError && <div className="sf-rl-message is-error" role="alert"><span>{loadError}</span><button type="button" className="sf-rl-btn" disabled={loading} onClick={() => void refresh()}>Retry</button></div>}
      {message && <div className={`sf-rl-message is-${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'}>
        <span>{message.text}</span>
        {message.ask && onAskAgent && <button type="button" className="sf-rl-btn" onClick={() => onAskAgent(message.ask!)}>Ask the agent</button>}
      </div>}
      <div className="sf-rl-section-head"><h3 className="sf-rl-section">Versions</h3>{state && !state.needsReadApproval && !state.versionsError && <span className="sf-rl-count">{state.versions.length}</span>}</div>
      {state?.needsReadApproval && <div className="sf-rl-empty">
        {state.org.alias} is a {state.org.kind} org. Reading its versions needs your approval.{' '}
        <button type="button" className="sf-rl-btn" disabled={busy !== null} onClick={() => void step('org.read')}>Load versions…</button>
      </div>}
      {state?.versionsError && <div className="sf-rl-empty" role="status" data-testid="release-versions-error">
        <strong>Versions unavailable</strong><p>{state.versionsError}</p><p>You can still publish this draft.</p>
        <button type="button" className="sf-rl-btn" disabled={loading} onClick={() => void refresh()}>Retry</button>
      </div>}
      {state && !state.needsReadApproval && !state.versionsError && state.versions.length === 0 && <div className="sf-rl-empty"><CloudUpload size={20} aria-hidden="true" /><strong>No published versions yet.</strong><p>Publish your draft to create the first version.</p></div>}
      {state && state.versions.length > 0 && <ul className="sf-rl-versions" aria-label="Versions">
        {state.versions.map(version => {
          const key = `${version.active ? 'agent.deactivate' : 'agent.activate'}:${version.active ? '' : version.versionNumber}`;
          const blocked = !version.active && risky && !version.evidence?.passed;
          return <li key={version.id} className={`sf-rl-version${version.active ? ' is-active' : ''}`}>
            <div className="sf-rl-version-info">
            <span className="sf-rl-vn">v{version.versionNumber}</span>
            {version.active ? <span className="sf-rl-badge is-active">Active</span> : <span className="sf-rl-badge">Inactive</span>}
            {evidenceBadge(version)}
            <span className="sf-rl-date">{shortDate(version.modifiedAt)}</span>
            </div>
            <div className="sf-rl-version-actions">
            <button type="button" className="sf-rl-btn" disabled={opening !== null} aria-label={`View v${version.versionNumber}`}
              aria-pressed={opened?.versionNumber === version.versionNumber}
              onClick={() => void view(version.versionNumber)}>{opening === version.versionNumber ? 'Opening…' : 'View'}</button>
            {version.active
              ? <button type="button" className="sf-rl-btn is-danger" disabled={busy !== null} onClick={() => void step('agent.deactivate')}>{busy === key ? 'Deactivating…' : 'Deactivate…'}</button>
              : <button type="button" className={`sf-rl-btn${risky ? ' is-danger' : ''}`} disabled={busy !== null || blocked}
                title={blocked ? `Run a passing eval for v${version.versionNumber} before activating it on ${state.org.kind}.` : undefined}
                onClick={() => void step('agent.activate', { versionNumber: version.versionNumber })}>{busy === key ? 'Activating…' : 'Activate…'}</button>}
            </div>
          </li>;
        })}
      </ul>}
      {state && !state.needsReadApproval && !active && state.versions.length > 0 && <div className="sf-rl-empty">No version is active. Users cannot reach this agent.</div>}
      {opened && <VersionViewer key={`${opened.versionNumber}:${opened.fullName}`} version={opened} draft={source} dirty={dirty} onClose={closeViewer} />}
    </section>
  );
}
