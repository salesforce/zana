import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { callPluginRpc, experimental_requestApproval, useRealtime } from '@zana-ai/zcc-plugin-sdk/app';
import { STUDIO_CHANGED_CHANNEL, STUDIO_RPC, type CaseOutcome, type ScenarioCase, type ScenarioSuite } from '../../../lib/studio-contract.js';
import { RELEASE_RPC, type ReleasePrepared } from '../../../lib/release-contract.js';
import { FIX_LOOP_LIMITS, type FixLoop } from '../../../lib/fix-loop.js';
import { declined, type Message } from './ReleasePane.js';
import { OrgTestsView } from './OrgTestsView.js';

/**
 * The Tests tool: the agent's scenario suite as one table. Simulate runs the
 * editor source; Org eval runs the generated `sf agent test` spec against the
 * published agent; a proposal open in the editor can run without being stored.
 * "Make these pass" hands failing cases to the thread agent as a bounded fix loop.
 * AI role-play stays as the second view.
 */
export interface TestsPaneProps {
  pluginId: string;
  projectId?: string;
  threadId?: string;
  path: string | null;
  /** The editor source. Simulate runs it, not the file on disk. */
  source: string;
  visible: boolean;
  dirty: boolean;
  /** The source of an edit an agent is proposing, while the proposal is open. */
  proposalSource?: string | null;
  /** The AI role-play lab, the second view. */
  roleplay: ReactNode;
  onAskAgent?(prompt: string): void;
  /** Injected in tests. */
  call?: typeof callPluginRpc;
  requestApproval?: typeof experimental_requestApproval;
}

type Suite = ScenarioSuite & { sha256?: string };
interface Detail { caseId: string; outcome: CaseOutcome; notes: string[]; turns: Array<{ role: 'user' | 'agent'; text: string }> }
type Notice = Message & { allowReads?: boolean };
type Reply = { ok?: boolean; code?: string; error?: string; summary?: string } & Record<string, unknown>;

const SPEC_BYTES = 256_000;

const STYLES = `
.sf-tp { display: flex; flex-direction: column; gap: 10px; padding: 10px; color: var(--sf-text); font-size: 12px; min-height: 0; overflow: auto; flex: 1; }
.sf-tp-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sf-tp-head h2 { margin: 0; font-size: 13px; }
.sf-tp-seg { display: inline-flex; border: 1px solid var(--sf-border); border-radius: 6px; overflow: hidden; }
.sf-tp-seg button { border: 0; background: transparent; color: var(--sf-muted); padding: 3px 10px; font: inherit; cursor: pointer; }
.sf-tp-seg button[aria-pressed="true"] { background: var(--sf-soft); color: var(--sf-text); }
.sf-tp-spacer { flex: 1; }
.sf-tp-bar { display: flex; gap: 6px; flex-wrap: wrap; }
.sf-tp-btn { border: 1px solid var(--sf-border); background: transparent; color: var(--sf-text); border-radius: 6px; padding: 3px 10px; font: inherit; cursor: pointer; white-space: nowrap; }
.sf-tp-btn.is-primary { border-color: var(--sf-accent); color: var(--sf-accent); }
.sf-tp-btn:disabled { opacity: 0.5; cursor: default; }
.sf-tp-table { width: 100%; border-collapse: collapse; }
.sf-tp-table th { text-align: left; font-size: 10px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--sf-muted); padding: 4px 6px; border-bottom: 1px solid var(--sf-border); }
.sf-tp-table td { padding: 6px; border-bottom: 1px solid var(--sf-border); vertical-align: top; }
.sf-tp-row { cursor: pointer; }
.sf-tp-row:hover td { background: var(--sf-soft); }
.sf-tp-name { font-weight: 600; }
.sf-tp-sub { color: var(--sf-muted); overflow-wrap: anywhere; }
.sf-tp-chip { border-radius: 999px; padding: 0 6px; border: 1px solid var(--sf-border); color: var(--sf-muted); font-size: 11px; white-space: nowrap; }
.sf-tp-chip.is-pass { border-color: var(--sf-success); color: var(--sf-success); }
.sf-tp-chip.is-fail { border-color: var(--sf-danger); color: var(--sf-danger); }
.sf-tp-chip.is-pinned { border-color: var(--sf-accent); color: var(--sf-accent); margin-left: 6px; }
.sf-tp-detail { background: var(--sf-elevated); }
.sf-tp-compare { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; }
.sf-tp-compare h4 { margin: 0 0 4px; font-size: 11px; color: var(--sf-muted); }
.sf-tp-compare ul { margin: 0; padding-left: 16px; }
.sf-tp-turn { margin: 0 0 4px; white-space: pre-wrap; }
.sf-tp-message { border-radius: 6px; padding: 6px 8px; background: var(--sf-elevated); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.sf-tp-message.is-error { color: var(--sf-danger); }
.sf-tp-message.is-muted { color: var(--sf-muted); }
.sf-tp-loop { border: 1px solid var(--sf-accent); border-radius: 8px; padding: 8px; display: flex; flex-direction: column; gap: 4px; }
.sf-tp-loop ol { margin: 0; padding-left: 18px; }
.sf-tp-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; border: 1px solid var(--sf-border); border-radius: 8px; padding: 8px; }
.sf-tp-form label { display: flex; flex-direction: column; gap: 2px; color: var(--sf-muted); }
.sf-tp-form .is-wide { grid-column: 1 / -1; }
.sf-tp-form input, .sf-tp-form textarea { font: inherit; color: var(--sf-text); background: var(--sf-sunken); border: 1px solid var(--sf-border); border-radius: 6px; padding: 3px 6px; }
.sf-tp-foot { color: var(--sf-muted); margin: 0; }
.sf-tp-empty { color: var(--sf-muted); padding: 4px 2px; }
`;

const OUTCOME_LABEL: Record<CaseOutcome, string> = { pass: 'Pass', fail: 'Fail', inconclusive: 'Unclear' };
function Chip({ outcome, title }: { outcome?: CaseOutcome; title?: string }) {
  return <span className={`sf-tp-chip${outcome ? ` is-${outcome}` : ''}`} title={title}>{outcome ? OUTCOME_LABEL[outcome] : '—'}</span>;
}

const shortDate = (at: number) => new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** What a case checks, one line per kind. */
export function expectLines(expect: ScenarioCase['expect']): string[] {
  return [
    ...(expect.topic ? [`Topic ${expect.topic}`] : []),
    ...(expect.actions?.length ? [`Calls ${expect.actions.join(', ')}`] : []),
    ...(expect.contains?.length ? [`Mentions ${expect.contains.map(text => `"${text}"`).join(', ')}`] : []),
    ...(expect.criteria ? [expect.criteria] : [])
  ];
}

const list = (value: string) => value.split(',').map(item => item.trim()).filter(Boolean);
function uniqueId(name: string, taken: Set<string>): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'case';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

/** The thread agent's instructions for one fix loop. */
export function fixLoopPrompt(loop: Pick<FixLoop, 'id' | 'budget' | 'caseIds'>, path: string, cases: ScenarioCase[]): string {
  const names = loop.caseIds.map(id => { const c = cases.find(row => row.id === id); return c ? `"${c.name}" (${id})` : id; });
  return [
    `Make these failing Agentforce test cases pass: ${names.join(', ')}.`,
    `This is fix loop ${loop.id}. You have ${loop.budget} Simulate runs and may only change ${path}.`,
    `For each attempt, call sf_workbench with action suites.run and input { "loopId": "${loop.id}", "agentPath": "${path}", "source": <the full candidate source> }, then follow the "next" it returns.`,
    'Stop when every case passes or no attempts are left. Then propose your best candidate with ui.command editor.proposeEdit and say which cases still fail.',
    'Do not save, publish or activate anything.'
  ].join('\n');
}

export function TestsPane(props: TestsPaneProps) {
  const { pluginId, projectId, threadId, path, source, visible, dirty, proposalSource, roleplay, onAskAgent } = props;
  const call = props.call ?? callPluginRpc;
  const requestApproval = props.requestApproval ?? experimental_requestApproval;
  const [view, setView] = useState<'cases' | 'org' | 'roleplay'>('cases');
  const [roleplayShown, setRoleplayShown] = useState(false);
  const [suite, setSuite] = useState<Suite | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [details, setDetails] = useState<Record<string, Detail>>({});
  const [proposal, setProposal] = useState<Record<string, CaseOutcome>>({});
  const [loop, setLoop] = useState<FixLoop | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const sequence = useRef(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const rpc = useCallback(async (method: string, args: Record<string, unknown> = {}): Promise<Reply> => {
    const reply = await call(pluginId, method, { ...(projectId ? { projectId } : {}), ...(path ? { agentPath: path } : {}), ...args }) as Reply | null;
    return reply ?? { ok: false, error: 'No response.' };
  }, [call, path, pluginId, projectId]);

  const load = useCallback(async () => {
    const seq = ++sequence.current;
    if (!path) { setSuite(null); setLoop(null); setLoaded(true); return; }
    try {
      const [listed, latest] = await Promise.all([rpc(STUDIO_RPC.suites), rpc(STUDIO_RPC.loopGet)]);
      if (!alive.current || seq !== sequence.current) return;
      if (listed.ok !== false && Array.isArray(listed.suites)) setSuite((listed.suites as Suite[])[0] ?? null);
      else setNotice({ tone: 'error', text: listed.error || 'Could not read the scenario suite.' });
      if (latest.ok !== false) setLoop((latest.loop as FixLoop | null) ?? null);
    } catch (error) {
      if (alive.current && seq === sequence.current) setNotice({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      if (alive.current && seq === sequence.current) setLoaded(true);
    }
  }, [path, rpc]);

  useEffect(() => { setSuite(null); setLoop(null); setDetails({}); setProposal({}); setNotice(null); setExpanded(null); setAdding(false); setLoaded(false); }, [path]);
  useEffect(() => { setProposal({}); }, [proposalSource]);
  useEffect(() => { if (visible) void load(); }, [visible, load]);
  useRealtime(STUDIO_CHANGED_CHANNEL, payload => {
    const row = payload as { kind?: string; projectId?: string; path?: string; loopId?: string } | null;
    if (!row || (row.projectId && row.projectId !== projectId)) return;
    if (row.kind === 'suites' && visible) void load();
    if (row.kind === 'loop' && row.path === path && row.loopId) {
      void rpc(STUDIO_RPC.loopGet, { loopId: row.loopId }).then(reply => {
        if (alive.current && reply.ok !== false && reply.loop) setLoop(reply.loop as FixLoop);
      }).catch(() => undefined);
    }
  });

  /** Runs one step with the busy flag and an error notice; the step returns the notice to show, if any. */
  const perform = useCallback(async (key: string, work: () => Promise<Notice | null>) => {
    setBusy(key);
    setNotice(null);
    try {
      const next = await work();
      if (alive.current && next) setNotice(next);
    } catch (error) {
      if (alive.current) setNotice({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      if (alive.current) setBusy(null);
    }
  }, []);

  const simulate = (caseIds?: string[]) => perform(caseIds ? `case:${caseIds[0]}` : 'simulate', async () => {
    const reply = await rpc(STUDIO_RPC.suiteRun, { path: suite?.path, source, engine: 'preview', startedByUser: true, ...(threadId ? { threadId } : {}), ...(caseIds ? { caseIds } : {}) });
    if (reply.ok === false || !reply.suite) return { tone: 'error', text: reply.error || 'The suite could not run.' };
    if (!alive.current) return null;
    setSuite(current => ({ ...(reply.suite as Suite), sha256: current?.sha256 ?? (reply.suite as Suite).sha256 }));
    const rows = Array.isArray(reply.details) ? reply.details as Detail[] : [];
    setDetails(current => ({ ...current, ...Object.fromEntries(rows.map(row => [row.caseId, row])) }));
    return null;
  });

  const runProposal = () => perform('proposal', async () => {
    const reply = await rpc(STUDIO_RPC.suiteRun, { path: suite?.path, source: proposalSource, engine: 'preview', store: false, startedByUser: true, ...(threadId ? { threadId } : {}) });
    if (reply.ok === false) return { tone: 'error', text: reply.error || 'The proposal could not run.' };
    const results = (reply.results ?? {}) as Record<string, { outcome: CaseOutcome }>;
    if (alive.current) setProposal(Object.fromEntries(Object.entries(results).map(([id, row]) => [id, row.outcome])));
    return { tone: 'muted', text: 'Ran the proposal in Simulate. Its results are not saved.' };
  });

  const evaluate = useCallback(async (): Promise<Notice | null> => {
    const reply = await rpc(STUDIO_RPC.suiteEval);
    if (reply.ok === false) {
      if (reply.code === 'refused') return { tone: 'error', text: 'This org is production or unknown. Running evals on it needs your approval.', allowReads: true };
      return { tone: 'error', text: reply.error || 'The org eval failed.' };
    }
    if (alive.current && reply.suite) setSuite(current => ({ ...(reply.suite as Suite), sha256: current?.sha256 ?? (reply.suite as Suite).sha256 }));
    return { tone: 'ok', text: reply.summary || 'Org eval finished.' };
  }, [rpc]);

  const allowReads = () => perform('reads', async () => {
    const prepared = await rpc(RELEASE_RPC.prepare, { path, action: 'org.read' }) as Reply & { data?: ReleasePrepared };
    if (prepared.ok === false && prepared.code !== 'not_needed') return { tone: 'error', text: prepared.error || 'Could not prepare the approval.' };
    if (prepared.ok !== false && prepared.data) {
      const answer = await requestApproval(pluginId, prepared.data.request);
      if (!answer.approved) return declined(answer.reason);
      const granted = await rpc(RELEASE_RPC.run, { path, action: 'org.read', token: answer.token });
      if (granted.ok === false) return { tone: 'error', text: granted.error || 'The approval was not accepted.' };
    }
    return evaluate();
  });

  const save = async (cases: ScenarioCase[]): Promise<Notice | null> => {
    const reply = await rpc(STUDIO_RPC.suiteSave, { cases, ...(suite?.sha256 ? { expectedSha256: suite.sha256 } : {}) });
    if (reply.ok === false || !reply.suite) return { tone: 'error', text: reply.error || 'The suite could not be saved.' };
    if (alive.current) setSuite(reply.suite as Suite);
    return null;
  };

  const addCase = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const field = (name: string) => String(form.get(name) ?? '').trim();
    const name = field('name');
    const utterances = field('utterances').split('\n').map(line => line.trim()).filter(Boolean);
    if (!name || !utterances.length) { setNotice({ tone: 'error', text: 'A case needs a name and at least one utterance.' }); return; }
    const existing = suite?.cases ?? [];
    const next: ScenarioCase = {
      id: uniqueId(name, new Set(existing.map(c => c.id))), name, utterances,
      expect: {
        ...(field('topic') ? { topic: field('topic') } : {}),
        ...(list(field('actions')).length ? { actions: list(field('actions')) } : {}),
        ...(list(field('contains')).length ? { contains: list(field('contains')) } : {}),
        ...(field('criteria') ? { criteria: field('criteria') } : {})
      }
    };
    void perform('add', async () => {
      const failed = await save([...existing, next]);
      if (!failed && alive.current) setAdding(false);
      return failed;
    });
  };

  const importFile = (file: File | undefined) => {
    if (fileInput.current) fileInput.current.value = '';
    if (!file) return;
    if (file.size > SPEC_BYTES) { setNotice({ tone: 'error', text: 'The spec is larger than 256 KB.' }); return; }
    void perform('import', async () => {
      const reply = await rpc(STUDIO_RPC.suiteImport, { text: await file.text() });
      if (reply.ok === false || !reply.suite) return { tone: 'error', text: reply.error || 'The spec could not be imported.' };
      if (alive.current) setSuite(reply.suite as Suite);
      return { tone: 'ok', text: `Imported ${Number(reply.imported) || 0} case${reply.imported === 1 ? '' : 's'} from ${file.name}.` };
    });
  };

  const writeSpec = () => perform('spec', async () => {
    const reply = await rpc(STUDIO_RPC.suiteSpec);
    if (reply.ok === false) return { tone: 'error', text: reply.error || 'The eval spec could not be written.' };
    const multi = Array.isArray(reply.multiTurn) ? reply.multiTurn.length : 0;
    return { tone: 'ok', text: `Wrote ${String(reply.specPath)}.${multi ? ` ${multi} multi-turn case${multi === 1 ? '' : 's'} run their first turn only.` : ''}` };
  });

  const failing = suite ? suite.cases.filter(c => suite.lastResults?.[c.id]?.outcome === 'fail').map(c => c.id) : [];
  const startLoop = () => perform('loop', async () => {
    const reply = await rpc(STUDIO_RPC.loopStart, { caseIds: failing, budget: FIX_LOOP_LIMITS.budget });
    if (reply.ok === false || !reply.loop) return { tone: 'error', text: reply.error || 'The fix loop could not start.' };
    const started = reply.loop as FixLoop;
    if (!alive.current) return null;
    setLoop(started);
    onAskAgent?.(fixLoopPrompt(started, path ?? '', suite?.cases ?? []));
    return null;
  });
  const stopLoop = () => perform('stop', async () => {
    const reply = await rpc(STUDIO_RPC.loopStop, { loopId: loop?.id });
    if (reply.ok === false) return { tone: 'error', text: reply.error || 'The fix loop could not stop.' };
    if (alive.current && reply.loop) setLoop(reply.loop as FixLoop);
    return null;
  });

  const showView = (next: 'cases' | 'org' | 'roleplay') => { setView(next); if (next === 'roleplay') setRoleplayShown(true); };
  const switcher = (
    <div className="sf-tp-seg" role="group" aria-label="Tests view">
      <button type="button" aria-pressed={view === 'cases'} onClick={() => showView('cases')}>Cases</button>
      <button type="button" aria-pressed={view === 'org'} onClick={() => showView('org')}>Org tests</button>
      <button type="button" aria-pressed={view === 'roleplay'} onClick={() => showView('roleplay')}>Role-play</button>
    </div>
  );
  const roleplayView = roleplayShown && <div hidden={view !== 'roleplay'} style={{ display: view === 'roleplay' ? 'flex' : 'none', flex: 1, minHeight: 0 }}>{roleplay}</div>;

  if (!path) {
    return <section className="sf-tp" aria-label="Tests" data-testid="studio-tests-pane"><style>{STYLES}</style>
      <div className="sf-tp-head"><h2>Tests</h2><span className="sf-tp-spacer" />{switcher}</div>
      {view === 'cases' && <div className="sf-tp-empty">Open an agent file to test it.</div>}
      {view === 'org' && <OrgTestsView pluginId={pluginId} projectId={projectId} threadId={threadId} path={path} visible={visible} onAskAgent={onAskAgent} call={props.call} requestApproval={props.requestApproval} />}
      {roleplayView}
    </section>;
  }

  const lastEval = suite?.lastEval;
  const cases = suite?.cases ?? [];
  const showProposal = Boolean(proposalSource);
  const running = busy !== null;
  const loopLive = loop?.status === 'running';
  const askWhy = (c: ScenarioCase) => {
    const detail = details[c.id];
    onAskAgent?.([
      `Explain why the Agentforce test case "${c.name}" (${c.id}) fails in Simulate for ${path}, and suggest a fix.`,
      `Utterances: ${c.utterances.join(' / ')}`,
      `Expected: ${expectLines(c.expect).join('; ') || 'nothing specific'}`,
      ...(detail?.notes.length ? [`Observed: ${detail.notes.join('; ')}`] : []),
      'Propose changes with ui.command editor.proposeEdit. Do not save or publish.'
    ].join('\n'));
  };

  return (
    <section className="sf-tp" aria-label="Tests" data-testid="studio-tests-pane">
      <style>{STYLES}</style>
      <div className="sf-tp-head">
        <h2>Tests</h2>
        {suite && <span className="sf-tp-sub">{suite.path} · {cases.length} case{cases.length === 1 ? '' : 's'}</span>}
        <span className="sf-tp-spacer" />
        {switcher}
      </div>
      {view === 'cases' && <>
        <div className="sf-tp-bar" role="toolbar" aria-label="Test actions">
          <button type="button" className="sf-tp-btn is-primary" disabled={running || !cases.length || !source.trim()} onClick={() => void simulate()}>{busy === 'simulate' ? 'Running…' : 'Run all in Simulate'}</button>
          <button type="button" className="sf-tp-btn" disabled={running || !cases.length} onClick={() => void perform('eval', evaluate)}>{busy === 'eval' || busy === 'reads' ? 'Running org eval…' : 'Run org eval'}</button>
          {showProposal && <button type="button" className="sf-tp-btn" disabled={running || !cases.length} onClick={() => void runProposal()}>{busy === 'proposal' ? 'Running…' : 'Run with proposal'}</button>}
          <button type="button" className="sf-tp-btn" disabled={running} aria-expanded={adding} onClick={() => setAdding(open => !open)}>+ Case</button>
          <button type="button" className="sf-tp-btn" disabled={running} onClick={() => fileInput.current?.click()}>{busy === 'import' ? 'Importing…' : 'Import YAML / JSON'}</button>
          <input ref={fileInput} type="file" accept=".yaml,.yml,.json" hidden aria-label="Import test spec" data-testid="tests-import-input" onChange={event => importFile(event.currentTarget.files?.[0])} />
          <button type="button" className="sf-tp-btn" disabled={running || !cases.length} onClick={() => void writeSpec()}>Write eval spec</button>
          <span className="sf-tp-spacer" />
          {onAskAgent && <button type="button" className="sf-tp-btn" disabled={running || loopLive || !failing.length || dirty}
            title={dirty ? 'Save first: the agent starts from the file on disk.' : !failing.length ? 'Run in Simulate first; the fix loop takes the failing cases.' : undefined}
            onClick={() => void startLoop()}>{failing.length ? `Make ${failing.length === 1 ? 'this' : 'these'} pass` : 'Make these pass'}</button>}
        </div>
        {notice && <div className={`sf-tp-message is-${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
          <span>{notice.text}</span>
          {notice.allowReads && <button type="button" className="sf-tp-btn" disabled={running} onClick={() => void allowReads()}>Allow reads…</button>}
        </div>}
        {adding && <form className="sf-tp-form" aria-label="New test case" onSubmit={addCase}>
          <label>Name<input name="name" required maxLength={200} /></label>
          <label>Expected topic<input name="topic" maxLength={200} /></label>
          <label className="is-wide">Utterances, one per line<textarea name="utterances" rows={2} required /></label>
          <label>Expected actions, comma separated<input name="actions" /></label>
          <label>Reply mentions, comma separated<input name="contains" /></label>
          <label className="is-wide">Criteria for the AI judge<input name="criteria" maxLength={4000} /></label>
          <div className="sf-tp-bar is-wide"><button type="submit" className="sf-tp-btn is-primary" disabled={running}>Add case</button>
            <button type="button" className="sf-tp-btn" onClick={() => setAdding(false)}>Cancel</button></div>
        </form>}
        {loop && <div className="sf-tp-loop" data-testid="tests-loop" aria-label="Fix loop">
          <div className="sf-tp-head">
            <strong>Fix loop</strong>
            <span className="sf-tp-sub">{loop.status} · {loop.attempts.length} of {loop.budget} attempts · {loop.caseIds.length} case{loop.caseIds.length === 1 ? '' : 's'}</span>
            <span className="sf-tp-spacer" />
            {loopLive && <button type="button" className="sf-tp-btn" disabled={running} onClick={() => void stopLoop()}>Stop</button>}
          </div>
          {loop.attempts.length > 0 ? <ol>{loop.attempts.map(attempt => <li key={attempt.n}>
            {attempt.pass} of {attempt.total} pass{attempt.failing.length ? ` · still failing ${attempt.failing.join(', ')}` : ''}
          </li>)}</ol> : <span className="sf-tp-sub">Waiting for the agent's first run.</span>}
        </div>}
        {!loaded && !suite && <div className="sf-tp-empty">Loading cases…</div>}
        {loaded && !cases.length && <div className="sf-tp-empty">No cases yet. Add one, import a spec, or pin a conversation from Preview with Save as scenario.</div>}
        {cases.length > 0 && <table className="sf-tp-table" data-testid="tests-table">
          <thead><tr>
            <th>Case</th><th>Expects</th><th>Simulate</th>
            <th title={lastEval ? `${lastEval.org}, ${shortDate(lastEval.at)}${lastEval.perCase ? '' : '. The CLI reported totals only.'}` : 'Not run yet'}>Org eval{lastEval && !lastEval.perCase ? ' (totals)' : ''}</th>
            {showProposal && <th>Proposal</th>}
          </tr></thead>
          <tbody>{cases.map(c => {
            const open = expanded === c.id;
            const detail = details[c.id];
            const simulated = suite?.lastResults?.[c.id]?.outcome;
            const multiTurn = c.utterances.length > 1;
            return <Fragment key={c.id}>
              <tr className="sf-tp-row" data-testid={`tests-row-${c.id}`} aria-expanded={open} onClick={() => setExpanded(open ? null : c.id)}>
                <td><span className="sf-tp-name">{c.name}</span>
                  {c.pinned && <span className="sf-tp-chip is-pinned" title={`Pinned from run ${c.pinned.runId}, ${shortDate(c.pinned.at)}`}>Pinned</span>}
                  <div className="sf-tp-sub">{c.utterances[0]}{multiTurn ? ` (+${c.utterances.length - 1} turn${c.utterances.length === 2 ? '' : 's'})` : ''}</div></td>
                <td className="sf-tp-sub">{expectLines(c.expect).join(' · ') || 'No checks'}</td>
                <td><Chip outcome={busy === `case:${c.id}` ? undefined : simulated} /></td>
                <td><Chip outcome={lastEval?.results[c.id]?.outcome} title={multiTurn ? 'The org eval runs the first turn only.' : undefined} /></td>
                {showProposal && <td><Chip outcome={proposal[c.id]} /></td>}
              </tr>
              {open && <tr className="sf-tp-detail"><td colSpan={showProposal ? 5 : 4}>
                <div className="sf-tp-compare">
                  <div><h4>Expected</h4><ul>{(expectLines(c.expect).length ? expectLines(c.expect) : ['No checks']).map(line => <li key={line}>{line}</li>)}</ul></div>
                  <div><h4>Actual{detail ? '' : ' (run it to see)'}</h4>
                    {detail?.notes.length ? <ul>{detail.notes.map((note, index) => <li key={index}>{note}</li>)}</ul> : null}
                    {detail?.turns.filter(turn => turn.role === 'agent').map((turn, index) => <p key={index} className="sf-tp-turn">{turn.text}</p>)}
                  </div>
                </div>
                <div className="sf-tp-bar">
                  <button type="button" className="sf-tp-btn" disabled={running || !source.trim()} onClick={() => void simulate([c.id])}>{busy === `case:${c.id}` ? 'Running…' : 'Run in Simulate'}</button>
                  {onAskAgent && simulated === 'fail' && <button type="button" className="sf-tp-btn" onClick={() => askWhy(c)}>Ask why</button>}
                  <button type="button" className="sf-tp-btn" disabled={running || cases.length < 2} title={cases.length < 2 ? 'A suite keeps at least one case.' : undefined}
                    onClick={() => void perform('remove', () => save(cases.filter(row => row.id !== c.id)))}>Remove</button>
                </div>
              </td></tr>}
            </Fragment>;
          })}</tbody>
        </table>}
        <p className="sf-tp-foot">Simulate runs the editor source{dirty ? ', including unsaved changes' : ''}. Org eval runs <code>sf agent test run-eval</code> against the agent published on the org; a pass counts as Release eval evidence.</p>
      </>}
      {view === 'org' && <OrgTestsView pluginId={pluginId} projectId={projectId} threadId={threadId} path={path} visible={visible} onAskAgent={onAskAgent} call={props.call} requestApproval={props.requestApproval} />}
      {roleplayView}
    </section>
  );
}
