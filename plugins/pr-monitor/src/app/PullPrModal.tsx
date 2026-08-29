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

import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Loader2, GitPullRequest } from 'lucide-react';
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
  const numberRef = useRef<HTMLInputElement | null>(null);

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pulling) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, pulling]);

  const selectedRepo = useMemo(
    () => repos.find((r) => `${r.host}|${r.owner}/${r.repo}` === repoKey),
    [repos, repoKey]
  );

  const submit = async () => {
    setError(null);
    const num = Number(number.trim());
    if (!selectedRepo) {
      setError('Select a repository.');
      return;
    }
    if (!Number.isFinite(num) || num <= 0) {
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
    <div className="modal-backdrop" onClick={() => !pulling && onClose()}>
      <div
        className="modal prm-modal"
        role="dialog"
        aria-modal
        aria-labelledby="prm-pull-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="prm-modal-header">
          <h3 id="prm-pull-title">
            <GitPullRequest size={14} aria-hidden /> Add PR
          </h3>
          <button type="button" className="prm-row-icon-btn" onClick={onClose} title="Close">
            <X size={14} />
          </button>
        </header>
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
              ref={numberRef}
              type="number"
              min={1}
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

          {error && <div className="prm-modal-error">{error}</div>}
        </div>
        {/* Positive action on the LEFT, Cancel on the RIGHT (§8b button order). */}
        <footer className="prm-modal-footer">
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
          <button type="button" className="prm-btn" onClick={onClose} disabled={pulling} title="Cancel without adding">
            Cancel
          </button>
        </footer>
      </div>
    </div>
  );
}
