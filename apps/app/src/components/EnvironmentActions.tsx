import { useEffect, useState } from 'react';
import type { GitHostPullRequest, ProvisioningTranscriptEntry, WorkspaceStatus } from '@zana-ai/zcc-domain';
import { product } from '../lib/product-client.js';
import { subscribeProductEvent } from '../lib/product-ws.js';

interface Props {
  environmentId: string | null | undefined;
}

export function EnvironmentActions({ environmentId }: Props) {
  const [status, setStatus] = useState<WorkspaceStatus | null>(null);
  const [pr, setPr] = useState<GitHostPullRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<ProvisioningTranscriptEntry[]>([]);

  useEffect(() => {
    if (!environmentId) return;
    let cancelled = false;
    void Promise.all([
      product.environments.status(environmentId).catch(() => null),
      product.environments.pullRequest(environmentId).catch(() => ({ pullRequest: null }))
    ]).then(([nextStatus, nextPr]) => {
      if (cancelled) return;
      setStatus(nextStatus);
      setPr(nextPr?.pullRequest ?? null);
    });
    const unsubscribe = subscribeProductEvent('threads:event', (payload: unknown) => {
      if (!payload || typeof payload !== 'object') return;
      const event = payload as { kind?: unknown; payload?: unknown };
      if (event.kind !== 'environment.provision.progress') return;
      const entry = event.payload as ProvisioningTranscriptEntry | undefined;
      if (entry?.text) setTranscript((current) => [...current, entry]);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [environmentId]);

  if (!environmentId) return null;

  const run = async (action: Parameters<typeof product.environments.action>[1]) => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await product.environments.action(environmentId, action);
      setMessage(typeof result.message === 'string' ? result.message : 'Done');
      const nextStatus = await product.environments.status(environmentId).catch(() => null);
      const nextPr = await product.environments.pullRequest(environmentId).catch(() => ({ pullRequest: null }));
      setStatus(nextStatus);
      setPr(nextPr?.pullRequest ?? null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="environment-actions" aria-label="Workspace git" data-testid="environment-actions">
      <header>
        <strong>{status?.branchName ?? 'Workspace'}</strong>
        <span>{status?.dirty ? 'uncommitted changes' : 'clean'}</span>
      </header>
      {transcript.length > 0 && (
        <pre className="environment-transcript">{transcript.map((entry) => entry.text).join('\n')}</pre>
      )}
      {status?.files?.length ? (
        <ul className="environment-changes">
          {status.files.slice(0, 12).map((file) => (
            <li key={file.path}>{file.kind} {file.path}</li>
          ))}
        </ul>
      ) : null}
      <div className="environment-action-row">
        <button type="button" disabled={busy || !status?.dirty} onClick={() => void run({ action: 'commit' })}>
          Commit
        </button>
        {status?.defaultBranch && status.branchName && status.branchName !== status.defaultBranch && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run({ action: 'squash_merge', targetBranch: status.defaultBranch! })}
          >
            Squash into {status.defaultBranch}
          </button>
        )}
      </div>
      <div className="environment-action-row">
        {pr ? (
          <>
            <a href={pr.url} target="_blank" rel="noreferrer">PR #{pr.number}</a>
            <button type="button" disabled={busy} onClick={() => void run({ action: pr.isDraft ? 'pull_request_ready' : 'pull_request_draft' })}>
              {pr.isDraft ? 'Mark ready' : 'Convert to draft'}
            </button>
            <button type="button" disabled={busy} onClick={() => void run({ action: 'pull_request_merge', method: 'squash' })}>
              Merge squash
            </button>
          </>
        ) : (
          <span>No pull request for this branch</span>
        )}
      </div>
      {message && <p className="environment-action-message">{message}</p>}
    </section>
  );
}
