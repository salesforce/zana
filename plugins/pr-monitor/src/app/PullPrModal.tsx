/**
 * "Pull PR" dialog (R-LIST-003) — import a specific pull request by picking its
 * repository and entering its number, without waiting for auto-discovery.
 *
 * The Repository selector lists exactly the connected + active repositories
 * (AC-LIST-3.3), loaded from the main `listRepos` handler. Confirming with
 * **Pull** dispatches the main `pullPr` handler (which re-validates the repo
 * against the connected+active set and fetches the PR); **Cancel** dismisses
 * without adding anything. A pulled PR is treated as manual (AC-LIST-3.4) —
 * handled main-side.
 */

import { useEffect, useMemo, useState } from 'react';
import { Loader2, GitPullRequest } from 'lucide-react';
import { Dialog } from './Dialog.js';
import type { ModuleHost } from './host.js';
import type { MonitoredPr, MonitoredRepo, ConnectionState } from '../../lib/types.js';

type RepoRow = MonitoredRepo & { shortHost: string; connection: ConnectionState };

interface Props {
  host: ModuleHost;
  onClose: () => void;
  /** Fires with the updated monitored-PR list on a successful pull. */
  onPulled: (prs: MonitoredPr[]) => void;
}

export function PullPrModal({ host, onClose, onPulled }: Props) {
  const [repos, setRepos] = useState<RepoRow[]>([]);
  const [reposLoaded, setReposLoaded] = useState(false);
  const [repoKey, setRepoKey] = useState('');
  const [number, setNumber] = useState('');
  const [pulling, setPulling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load connected + active repositories (AC-LIST-3.3). A disconnected host
  // can't be fetched, and main's pullPr rejects it — so offering it here would
  // only produce a submit error. Filter to active AND connected.
  useEffect(() => {
    let alive = true;
    host
      .call<{ ok: boolean; repos?: RepoRow[] }>('listRepos')
      .then((res) => {
        if (!alive) return;
        const active = (res?.repos ?? []).filter((r) => r.active && r.connection === 'connected');
        setRepos(active);
        if (active.length > 0) setRepoKey(`${active[0].host}|${active[0].owner}/${active[0].repo}`);
        setReposLoaded(true);
      })
      .catch(() => {
        if (alive) setReposLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [host]);

  const selectedRepo = useMemo(
    () => repos.find((r) => `${r.host}|${r.owner}/${r.repo}` === repoKey),
    [repos, repoKey]
  );

  const submit = async () => {
    if (pulling) return;
    setError(null);
    const num = Number(number.trim());
    if (!selectedRepo) {
      setError('Select a repository.');
      return;
    }
    if (!Number.isSafeInteger(num) || num <= 0) {
      setError('Enter a valid PR number.');
      return;
    }
    setPulling(true);
    try {
      const res = await host.call<{ ok: boolean; prs?: MonitoredPr[]; error?: string }>('pullPr', {
        host: selectedRepo.host,
        fullName: `${selectedRepo.owner}/${selectedRepo.repo}`,
        number: num,
      });
      if (res?.ok && Array.isArray(res.prs)) {
        onPulled(res.prs);
      } else {
        setError(res?.error || 'Failed to pull PR.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPulling(false);
    }
  };

  return (
    <Dialog title="Add PR" titleId="prm-pull-title" icon={<GitPullRequest size={16} />}
      onClose={onClose} busy={pulling}>
        <div className="prm-modal-body">
          <p className="prm-modal-desc">Import a specific pull request by number.</p>

          <label className="prm-field">
            <span className="prm-field-label">Repository</span>
            {reposLoaded && repos.length === 0 ? (
              <span className="prm-field-hint">
                No connected repositories. Connect one in Settings first.
              </span>
            ) : (
              <select
                className="prm-input prm-input--select"
                value={repoKey}
                onChange={(e) => setRepoKey(e.target.value)}
                disabled={pulling || !reposLoaded}
                aria-label="Repository"
              >
                {!reposLoaded && <option>Loading…</option>}
                {repos.map((r) => {
                  const key = `${r.host}|${r.owner}/${r.repo}`;
                  return (
                    <option key={key} value={key}>
                      {r.owner}/{r.repo} ({r.shortHost})
                    </option>
                  );
                })}
              </select>
            )}
          </label>

          <label className="prm-field">
            <span className="prm-field-label">PR number</span>
            <input
              type="number"
              min={1}
              step={1}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "prm-pull-error" : undefined}
              value={number}
              placeholder="e.g. 42"
              className="prm-input"
              onChange={(e) => {
                setNumber(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !pulling) {
                  e.preventDefault();
                  void submit();
                }
              }}
              disabled={pulling || repos.length === 0}
            />
          </label>

          {error && <div className="prm-modal-error" id="prm-pull-error" role="alert">{error}</div>}
        </div>
        <footer className="prm-modal-footer">
          <button type="button" className="prm-btn" onClick={onClose} disabled={pulling} title="Cancel without adding">
            Cancel
          </button>
          <button
            type="button"
            className="prm-btn prm-btn--primary"
            onClick={() => void submit()}
            disabled={pulling || repos.length === 0 || !number.trim()}
            title="Add this PR to the monitored list"
          >
            {pulling ? <Loader2 size={13} className="prm-spin" /> : null}
            <span>Add</span>
          </button>
        </footer>
    </Dialog>
  );
}
