import { useEffect, useRef, useState } from 'react';
import type { PeerConflictChoices, PeerConflictQuestion, PeerConflictReview, PeerResolutionChoice } from '../shared/contract.js';
import { errorMessage, useApi } from './api.js';
import { foldDiff, lineDiff, type DiffLine } from './diff.js';
import { useResource } from './hooks.js';
import { Dialog } from './ui.js';

const CHOICE_LABEL: Record<PeerResolutionChoice, string> = { local: 'Keep mine', remote: 'Use theirs', merge: 'Keep both' };

function DiffLineView({ line }: { line: DiffLine }) {
  const marker = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
  const word = line.type === 'add' ? 'added' : line.type === 'del' ? 'removed' : 'unchanged';
  return <span className={`dd-diff-${line.type}`}><span className="dd-diff-sign" aria-hidden="true">{marker}</span>
    <span className="dd-visually-hidden" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{word}: </span>{line.text}{'\n'}</span>;
}

/** One side compared with the common version. Markers (+/-) and the heading carry meaning, not only colour. */
function Diff({ label, before, after }: { label: string; before: string; after: string }) {
  const lines = lineDiff(before, after);
  if (!lines) return <p>{label}: the difference is too large to show. Choose using the file name.</p>;
  const changed = lines.some((line) => line.type !== 'same');
  return <section aria-label={`${label} changes`}><h4>{label}</h4>
    {changed ? <pre className="dd-conflict-diff">{foldDiff(lines).map((hunk, index) => hunk.type === 'gap'
      ? <span key={index}>... {hunk.count} unchanged lines{'\n'}</span>
      : hunk.lines.map((line, lineIndex) => <DiffLineView key={`${index}-${lineIndex}`} line={line} />))}</pre>
      : <p>No changes from the common version.</p>}
  </section>;
}

function QuestionReview({ docId, remoteHead, localHead, question, choice, onChoice, onStale }: {
  docId: string; remoteHead: string; localHead: string; question: PeerConflictQuestion; choice?: PeerResolutionChoice;
  onChoice(choice: PeerResolutionChoice): void; onStale(stale: boolean): void;
}) {
  const api = useApi();
  const path = question.kind === 'file' ? question.key.slice('file:'.length) : '';
  const file = useResource(path ? `${docId}\0${remoteHead}\0${path}\0${localHead}` : null, () => api.peerConflictFile(docId, remoteHead, path));
  const stale = !!file.data && file.data.localHead !== localHead;
  useEffect(() => { onStale(stale); return () => onStale(false); }, [stale]);
  const text = (side: { content: string; encoding: 'utf8' | 'base64' } | null | undefined) => side?.encoding === 'base64' ? null : side?.content ?? '';
  const base = text(file.data?.base), mine = text(file.data?.local), theirs = text(file.data?.remote);
  const groupName = `choice-${question.key}`;
  return <section aria-label={`Resolve ${question.label}`}>
    <h3>{question.label}</h3>
    {question.kind === 'file' ? file.error ? <p role="alert">{file.error}</p> : file.loading ? <p>Loading {question.label}...</p>
      : base !== null && mine !== null && theirs !== null
        ? <><Diff label="Mine compared with common version" before={base} after={mine} /><Diff label="Theirs compared with common version" before={base} after={theirs} /></>
        : <p>Binary file. Both versions are kept in history. Choose which to use.</p>
      : <dl><dt>Mine</dt><dd>{question.localValue}</dd><dt>Theirs</dt><dd>{question.remoteValue}</dd></dl>}
    <fieldset><legend>Choose version for {question.label}</legend>
      {question.choices.map((value) => <label key={value} style={{ display: 'block' }}><input type="radio" name={groupName} value={value}
        checked={choice === value} onChange={() => onChoice(value)} /> {CHOICE_LABEL[value]}</label>)}
    </fieldset>
  </section>;
}

function ForkReview({ docId, remoteHead, onResolved }: { docId: string; remoteHead: string; onResolved(): void }) {
  const api = useApi();
  const review = useResource(`${docId}\0${remoteHead}`, () => api.peerConflictReview(docId, remoteHead));
  const [step, setStep] = useState(0);
  const [choices, setChoices] = useState<PeerConflictChoices>({});
  const [docChoice, setDocChoice] = useState<PeerResolutionChoice | null>(null);
  const [fileStale, setFileStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heading = useRef<HTMLDivElement>(null);
  const data = review.data;
  const questions = data?.questions ?? [];
  const question = questions[Math.min(step, Math.max(questions.length - 1, 0))];
  // After a re-review against a new head, keep the draft for questions that still exist and are still valid.
  useEffect(() => {
    if (!data) return;
    setChoices((current) => Object.fromEntries(Object.entries(current).filter(([key, value]) => data.questions.some((q) => q.key === key && q.choices.includes(value)))));
    setStep((value) => Math.min(value, Math.max(data.questions.length - 1, 0)));
    setDocChoice((current) => current ?? (data.questions.length === 0 && data.mergeAvailable ? 'merge' : null));
  }, [data]);
  const move = (next: number) => { setStep(next); queueMicrotask(() => heading.current?.focus()); };
  const stale = fileStale;
  const complete = questions.length ? questions.every((entry) => choices[entry.key] !== undefined) : docChoice !== null && (docChoice !== 'merge' || !!data?.mergeAvailable);
  const resolve = async (snapshot: PeerConflictReview) => {
    setBusy(true); setError(null);
    try {
      await api.resolvePeerConflict(docId, questions.length
        ? { expectedHead: snapshot.localHead, remoteHead, choices }
        : { expectedHead: snapshot.localHead, remoteHead, choice: docChoice! });
      onResolved();
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  };
  if (review.error) return <p role="alert">{review.error}</p>;
  if (!data) return <p role="status">Loading fork...</p>;
  const names = questions.map((entry) => entry.label).join(', ');
  return <section aria-label="Review peer fork">
    <p>Local: {data.local.title} ({data.local.status}). Peer: {data.remote.title} ({data.remote.status}).</p>
    {questions.length ? <p>{questions.length} {questions.length === 1 ? 'item differs' : 'items differ'}: {names}. Choose which to keep.</p> : null}
    {data.settled?.length ? <details><summary>{data.settled.length} files need no choice</summary><ul>
      {data.settled.map((entry) => <li key={entry.path}>{entry.path}: {entry.state === 'only-mine' ? 'only changed on this computer, kept'
        : entry.state === 'only-theirs' ? 'only changed on the other computer, taken' : entry.state === 'merged' ? 'changed in different places, merged' : 'same on both computers'}</li>)}
    </ul></details> : null}
    {stale ? <p role="alert">Document head changed while loading the file. Review again before resolving.</p> : null}
    {questions.length && question ? <>
      <div ref={heading} tabIndex={-1}><p role="status">File {step + 1} of {questions.length}</p></div>
      <QuestionReview key={question.key} docId={docId} remoteHead={remoteHead} localHead={data.localHead} question={question}
        choice={choices[question.key]} onStale={setFileStale} onChoice={(choice) => setChoices((current) => ({ ...current, [question.key]: choice }))} />
      <button type="button" className="btn" disabled={step === 0 || busy} onClick={() => move(step - 1)}>Back</button>
      {step < questions.length - 1 ? <button type="button" className="btn" disabled={!choices[question.key] || busy} onClick={() => move(step + 1)}>Next</button> : null}
    </> : <fieldset><legend>Resolution</legend>
      {data.conflicts.length ? <p>{data.conflicts.join('; ')}</p> : <p>Different parts changed on each side; they merge safely.</p>}
      {(['merge', 'local', 'remote'] as const).filter((value) => value !== 'merge' || data.mergeAvailable).map((value) =>
        <label key={value} style={{ display: 'block' }}><input type="radio" name="doc-choice" value={value} checked={docChoice === value} disabled={busy}
          onChange={() => setDocChoice(value)} /> {value === 'merge' ? 'Merge changes' : CHOICE_LABEL[value]}</label>)}
    </fieldset>}
    {data.conflicts.includes('history causal order conflict') ? <p>History order differs. Explicit selection keeps the selected branch's order and retains remaining snapshots.</p> : null}
    <p>Both original versions remain in peer history. Resolution saves locally, does not share unsaved editor buffers, and does not trigger automatic sync. Use Sync Now to share it.</p>
    {error ? <p role="alert">Resolution failed: {error}. No changes were saved; both forks remain available. Review again before retrying.</p> : null}
    <button type="button" className="btn primary" disabled={busy || review.loading || !complete || stale} onClick={() => void resolve(data)}>Resolve reviewed fork</button>
    {error || stale ? <button type="button" className="btn" disabled={busy} onClick={() => { setError(null); review.reload(); }}>Review again</button> : null}
  </section>;
}

export function PeerConflictView({ docId, onClose, onOpenHistory }: { docId: string; onClose(): void; onOpenHistory?: () => void }) {
  const api = useApi();
  const [cursor, setCursor] = useState('');
  const page = useResource(`${docId}\0${cursor}`, () => api.peerConflicts(docId, cursor));
  const [remoteHead, setRemoteHead] = useState('');
  const [resolved, setResolved] = useState(false);
  const selected = remoteHead || page.data?.remoteHeads[0] || '';
  return <Dialog title="Peer conflicts" onClose={onClose} wide>
    {resolved ? <section aria-label="Resolution saved"><p role="status">Resolved. The version you did not choose stays in history.</p>
      {onOpenHistory ? <button type="button" className="btn" onClick={onOpenHistory}>Open history</button> : null}</section> : null}
    {page.error ? <p role="alert">{page.error}</p> : page.loading && !page.data ? <p role="status">Loading conflicts...</p> :
      page.data?.remoteHeads.length ? <>
        <label className="dd-field"><span>Peer version</span><select className="dd-input" value={selected} onChange={(event) => setRemoteHead(event.target.value)}>
          {page.data.remoteHeads.map((head) => <option key={head}>{head}</option>)}
        </select></label>
        <ForkReview key={selected} docId={docId} remoteHead={selected} onResolved={() => { setResolved(true); setRemoteHead(''); page.reload(); }} />
        {page.data.nextCursor ? <button type="button" className="btn" onClick={() => { setRemoteHead(''); setCursor(page.data!.nextCursor!); }}>Next conflicts</button> : null}
        {cursor ? <button type="button" className="btn" onClick={() => { setRemoteHead(''); setCursor(''); }}>First conflicts</button> : null}
      </> : <p>No unresolved peer forks.</p>}
  </Dialog>;
}
