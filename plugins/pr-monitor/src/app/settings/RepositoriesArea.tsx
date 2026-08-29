/**
 * Repositories area (R-REPO-*). The connected-repo list plus every repo
 * management flow:
 *   • Suggested for you (R-REPO-007) — scan 90-day activity, multi-select add.
 *   • Browse Organization Repositories (R-REPO-009) — owner-grouped, searchable.
 *   • Add repository manually (R-REPO-008) — inline owner/repo + org form.
 *   • Per-card: Open / Copy link quick actions; Test Connection / Edit /
 *     Notification Settings / Delete action row.
 *   • Repository Settings dialog (R-REPO-011) — General + Notifications tabs.
 *   • Test Connection (R-REPO-010) — result dialog.
 *
 * The renderer never opens a URL itself: `openExternal` scheme-validates to
 * http(s) before handing off (the renderer is untrusted — see CLAUDE.md).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Sparkles,
  FolderSearch,
  Plus,
  GitBranch,
  ExternalLink,
  Link2,
  Wifi,
  Edit2,
  Bell,
  Trash2,
  Loader2,
  CircleCheck,
  CircleX,
  ChevronRight,
  Clock,
} from 'lucide-react';
import type { ModuleHost } from '../host.js';
import {
  type ConnectionState,
  type MonitoredOrg,
  type MonitoredPr,
  type MonitoredRepo,
  type TisPresetId,
  TIS_PRESETS,
  REVIEW_TIS_PRESETS,
  DEFAULT_TIS_PRESET,
  DEFAULT_REVIEW_TIS_PRESET,
  PREFETCH_ORGS_CACHE_KEY,
  PREFETCH_REPOS_CACHE_KEY,
  MONITORED_PRS_CACHE_KEY,
  MONITORED_COUNT_CACHE_KEY,
} from '../../../lib/types.js';
import { formatRelative } from '../formatHelpers.js';
import { copyText } from '../clipboard.js';
import { AreaHeader, ConnectionPill, Dialog, ConfirmDialog } from './ui.js';

type RepoRow = MonitoredRepo & { shortHost: string; connection: ConnectionState };
type OrgRow = MonitoredOrg & { shortHost: string; connection: ConnectionState };
type RepoSettingsTab = 'general' | 'status' | 'notifications';

interface RemoteRepo {
  owner: string;
  repo: string;
  fullName: string;
  host: string;
  isPrivate?: boolean;
  /** True when this repo is already monitored — shown as a "Connected" pill. */
  alreadyAdded?: boolean;
}
interface SuggestedRow {
  owner: string;
  repo: string;
  fullName: string;
  host: string;
  prCount: number;
  lastActivity: number;
  alreadyAdded: boolean;
  orgLogin: string;
}

/** Scheme-validate then hand a GitHub URL to the host opener. */
function openExternal(host: ModuleHost, url: string) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return;
    host.openExternal(url);
  } catch {
    /* not a valid URL — ignore */
  }
}

function repoWebUrl(r: { host: string; owner: string; repo: string }): string {
  return `https://${r.host}/${r.owner}/${r.repo}`;
}

/** Copy text to the clipboard (with a sandbox-safe fallback), toasting the outcome. */
async function copyLink(host: ModuleHost, text: string) {
  if (await copyText(text)) {
    host.toast('Link copied', 'info');
  } else {
    host.toast('Failed to copy link', 'error');
  }
}

export function RepositoriesArea({
  host,
  onRepositoriesChanged,
}: {
  host: ModuleHost;
  /** Notify the panel that repo state changed so it can re-sync the board. */
  onRepositoriesChanged?: () => void;
}) {
  // Paint from the background-prefetched cache if it's warm (R-SET-005), so the
  // first open skips the gh-backed loading spinner. `load()` still refreshes.
  const [repos, setRepos] = useState<RepoRow[] | null>(() => {
    const cached = host.cache.get<{ ok?: boolean; repos?: RepoRow[] }>(PREFETCH_REPOS_CACHE_KEY);
    return cached?.ok && Array.isArray(cached.repos) ? cached.repos : null;
  });
  const [orgs, setOrgs] = useState<OrgRow[]>(() => {
    const cached = host.cache.get<{ ok?: boolean; orgs?: OrgRow[] }>(PREFETCH_ORGS_CACHE_KEY);
    return cached?.ok && Array.isArray(cached.orgs) ? cached.orgs : [];
  });
  const [error, setError] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [showSuggested, setShowSuggested] = useState(false);
  const [showBrowse, setShowBrowse] = useState(false);
  const [settingsFor, setSettingsFor] = useState<RepoRow | null>(null);
  const [settingsTab, setSettingsTab] = useState<RepoSettingsTab>('general');
  const [testFor, setTestFor] = useState<RepoRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<RepoRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [rRes, oRes] = await Promise.all([
        host.call<{ ok: boolean; repos?: RepoRow[]; error?: string }>('listRepos'),
        host.call<{ ok: boolean; orgs?: OrgRow[] }>('listOrgs'),
      ]);
      if (rRes?.ok && Array.isArray(rRes.repos)) {
        setRepos(rRes.repos);
        setError(null);
      } else {
        setRepos([]);
        if (rRes?.error) setError(rRes.error);
      }
      setOrgs(oRes?.ok && Array.isArray(oRes.orgs) ? oRes.orgs : []);
    } catch (err) {
      setRepos([]);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [host]);

  useEffect(() => {
    void load();
  }, [load]);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await host.call('deleteRepository', {
        host: pendingDelete.host,
        owner: pendingDelete.owner,
        repo: pendingDelete.repo,
      });
      await load();
    } catch (err) {
      host.toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };

  return (
    <div className="prm-area">
      <AreaHeader
        title="Repositories"
        subtitle="Manage your connected repositories"
        actions={
          <>
            <button type="button" className="prm-btn" onClick={() => setShowSuggested(true)}>
              <Sparkles size={13} /> <span>Suggested for you</span>
            </button>
            <button type="button" className="prm-btn" onClick={() => setShowBrowse(true)}>
              <FolderSearch size={13} /> <span>Browse Repositories</span>
            </button>
            <button type="button" className="prm-btn prm-btn--primary" onClick={() => setShowAdd(true)}>
              <Plus size={13} /> <span>Add repository manually</span>
            </button>
          </>
        }
      />

      {error && <div className="prm-error">{error}</div>}

      {repos === null ? (
        <div className="prm-loading">
          <Loader2 size={14} className="prm-spin" /> Loading repositories…
        </div>
      ) : repos.length === 0 ? (
        <div className="prm-area-empty">
          No repositories connected yet. Use <strong>Suggested for you</strong>,{' '}
          <strong>Browse</strong>, or <strong>Add repository manually</strong> to get started.
        </div>
      ) : (
        <div className="prm-card-list">
          {repos.map((r) => (
            <div key={`${r.host}|${r.owner}/${r.repo}`} className="prm-entity-card prm-repo-card">
              <div className="prm-repo-top">
                <div className="prm-entity-title">
                  <GitBranch size={14} aria-hidden />{' '}
                  <span>
                    {r.owner}/{r.repo}
                  </span>
                  <span className={`prm-active-badge${r.active ? '' : ' prm-active-badge--off'}`}>
                    {r.active ? 'Active' : 'Inactive'}
                  </span>
                  <ConnectionPill state={r.connection} />
                  {(() => {
                    // Build preset reads new → legacy → default (no migration on
                    // write needed). Review preset reads its own field → default.
                    const buildP = TIS_PRESETS[r.buildTisPreset ?? r.tisPreset ?? DEFAULT_TIS_PRESET];
                    const reviewP = REVIEW_TIS_PRESETS[r.reviewTisPreset ?? DEFAULT_REVIEW_TIS_PRESET];
                    return (
                      <>
                        <span
                          className="prm-tis-preset-pill"
                          title={`Build preset — warns after ${buildP.warnHours}h, behind schedule after ${buildP.dangerHours}h`}
                        >
                          <Clock size={11} aria-hidden />
                          Build: {buildP.label}
                        </span>
                        <span
                          className="prm-tis-preset-pill"
                          title={`Review preset — warns after ${reviewP.warnDays}d, behind schedule after ${reviewP.dangerDays}d`}
                        >
                          <Clock size={11} aria-hidden />
                          Review: {reviewP.label}
                        </span>
                      </>
                    );
                  })()}
                </div>
                <div className="prm-repo-quick">
                  <button
                    type="button"
                    className="prm-row-icon-btn prm-tip"
                    title="Open on GitHub"
                    data-tip="Open on GitHub"
                    aria-label="Open on GitHub"
                    onClick={() => openExternal(host, repoWebUrl(r))}
                  >
                    <ExternalLink size={14} />
                  </button>
                  <button
                    type="button"
                    className="prm-row-icon-btn prm-tip"
                    title="Copy link"
                    data-tip="Copy link"
                    aria-label="Copy link"
                    onClick={() => void copyLink(host, repoWebUrl(r))}
                  >
                    <Link2 size={14} />
                  </button>
                </div>
              </div>

              <div className="prm-entity-sub prm-repo-meta">
                <span>Organization: {r.orgLogin} ({r.shortHost})</span>
                <span>Created {formatRelative(r.createdAt)}</span>
              </div>

              <div className="prm-repo-actions">
                <button type="button" className="prm-btn prm-btn--sm" onClick={() => setTestFor(r)}>
                  <Wifi size={12} /> <span>Test Connection</span>
                </button>
                <button
                  type="button"
                  className="prm-btn prm-btn--sm"
                  onClick={() => {
                    setSettingsTab('general');
                    setSettingsFor(r);
                  }}
                >
                  <Edit2 size={12} /> <span>Edit Repository</span>
                </button>
                <button
                  type="button"
                  className="prm-btn prm-btn--sm"
                  onClick={() => {
                    setSettingsTab('status');
                    setSettingsFor(r);
                  }}
                  title="Status Settings"
                >
                  <Clock size={12} /> <span>Status Settings</span>
                </button>
                <button
                  type="button"
                  className="prm-btn prm-btn--sm"
                  onClick={() => {
                    setSettingsTab('notifications');
                    setSettingsFor(r);
                  }}
                  title="Notification Settings"
                >
                  <Bell size={12} /> <span>Notification Settings</span>
                </button>
                <button
                  type="button"
                  className="prm-btn prm-btn--sm prm-btn--danger-ghost"
                  onClick={() => setPendingDelete(r)}
                >
                  <Trash2 size={12} /> <span>Delete Repository</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <AddRepoForm
          host={host}
          orgs={orgs}
          onClose={() => setShowAdd(false)}
          onAdded={async () => {
            setShowAdd(false);
            await load();
          }}
        />
      )}
      {showSuggested && (
        <SuggestedDialog
          host={host}
          onClose={() => setShowSuggested(false)}
          onAdded={async () => {
            await load();
          }}
        />
      )}
      {showBrowse && (
        <BrowseDialog
          host={host}
          onClose={() => setShowBrowse(false)}
          onAdded={async () => {
            await load();
          }}
        />
      )}
      {settingsFor && (
        <RepoSettingsDialog
          host={host}
          repo={settingsFor}
          orgs={orgs}
          initialTab={settingsTab}
          onClose={() => setSettingsFor(null)}
          onSaved={async (prs) => {
            setSettingsFor(null);
            // Push refreshed PRs (if main re-ran the poll for a status-affecting
            // change) into the shared cache so the PR board reflects the new
            // build/review pill state immediately, before any re-sync.
            if (Array.isArray(prs)) {
              host.cache.set(MONITORED_PRS_CACHE_KEY, prs);
              host.cache.set(MONITORED_COUNT_CACHE_KEY, prs.length);
              host.cache.refreshBadge();
            }
            // Re-sync the panel's repo slice so the board's pill thresholds +
            // sfciGated flags reflect this edit immediately.
            onRepositoriesChanged?.();
            await load();
          }}
        />
      )}
      {testFor && (
        <TestConnectionDialog
          host={host}
          repo={testFor}
          onClose={() => setTestFor(null)}
          onResult={(ok) => {
            // AC-REPO-10.4: reflect the probe on the card's connection pill
            // (R-ORG-005 convention: Connected / Disconnected) without a Re-discover.
            const next: ConnectionState = ok ? 'connected' : 'disconnected';
            setRepos((prev) =>
              (prev ?? []).map((r) =>
                r.host === testFor.host && r.owner === testFor.owner && r.repo === testFor.repo
                  ? { ...r, connection: next }
                  : r
              )
            );
          }}
        />
      )}
      {pendingDelete && (
        <ConfirmDialog
          title="Delete repository?"
          danger
          busy={deleting}
          message="Are you sure you want to delete this repository? This will also delete all associated PRs."
          confirmLabel="Delete Repository"
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

// ── Add repository manually (R-REPO-008) ──────────────────────────────────────

function AddRepoForm({
  host,
  orgs,
  onClose,
  onAdded,
}: {
  host: ModuleHost;
  orgs: OrgRow[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [ref, setRef] = useState('');
  const [orgKey, setOrgKey] = useState(orgs[0] ? `${orgs[0].host}|${orgs[0].login}` : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const org = orgs.find((o) => `${o.host}|${o.login}` === orgKey);
    if (!org) {
      setError('Please select an organization.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await host.call<{ ok: boolean; error?: string }>('addRepository', {
        ref: ref.trim(),
        host: org.host,
        orgLogin: org.login,
      });
      if (res?.ok) onAdded();
      else setError(res?.error || 'Failed to add repository.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Add repository" icon={<Plus size={14} />} onClose={onClose} busy={busy}>
      <div className="prm-modal-body">
        <label className="prm-field">
          <span className="prm-field-label">Repository</span>
          <input
            type="text"
            className="prm-input"
            placeholder="owner/repo (e.g. my-org/my-repo)"
            value={ref}
            spellCheck={false}
            onChange={(e) => {
              setRef(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <span className="prm-field-hint">
            Enter as owner/repo, a full GitHub URL, or an SSH clone URL.
          </span>
        </label>
        <label className="prm-field">
          <span className="prm-field-label">Organization</span>
          <select
            className="prm-input prm-input--select"
            value={orgKey}
            onChange={(e) => setOrgKey(e.target.value)}
          >
            {orgs.length === 0 && <option value="">No organizations</option>}
            {orgs.map((o) => (
              <option key={`${o.host}|${o.login}`} value={`${o.host}|${o.login}`}>
                {o.login} ({o.shortHost})
              </option>
            ))}
          </select>
        </label>
        {error && <div className="prm-modal-error">{error}</div>}
      </div>
      <footer className="prm-modal-footer">
        <button type="button" className="prm-btn" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="prm-btn prm-btn--primary"
          onClick={() => void submit()}
          disabled={busy || !ref.trim()}
        >
          {busy ? <Loader2 size={13} className="prm-spin" /> : null}
          <span>Add Repository</span>
        </button>
      </footer>
    </Dialog>
  );
}

// ── Suggested for you (R-REPO-007) ────────────────────────────────────────────

function SuggestedDialog({
  host,
  onClose,
  onAdded,
}: {
  host: ModuleHost;
  onClose: () => void;
  onAdded: () => void | Promise<void>;
}) {
  const [rows, setRows] = useState<SuggestedRow[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const scan = useCallback(async () => {
    setRows(null);
    setError(null);
    try {
      const res = await host.call<{ ok: boolean; repos?: SuggestedRow[]; error?: string }>(
        'suggestRepositories'
      );
      if (res?.ok && Array.isArray(res.repos)) {
        setRows(res.repos);
        // Pre-check the already-added ones (shown checked + disabled).
        setSelected(new Set(res.repos.filter((r) => r.alreadyAdded).map((r) => r.fullName)));
      } else {
        setRows([]);
        if (res?.error) setError(res.error);
      }
    } catch (err) {
      setRows([]);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [host]);

  useEffect(() => {
    void scan();
  }, [scan]);

  const toggle = (r: SuggestedRow) => {
    if (r.alreadyAdded) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(r.fullName)) next.delete(r.fullName);
      else next.add(r.fullName);
      return next;
    });
  };

  const addSelected = async () => {
    if (!rows) return;
    const toAdd = rows.filter((r) => !r.alreadyAdded && selected.has(r.fullName));
    if (toAdd.length === 0) return;
    setAdding(true);
    try {
      await host.call('addRepositories', {
        repos: toAdd.map((r) => ({ owner: r.owner, repo: r.repo, host: r.host, orgLogin: r.orgLogin })),
      });
      // Keep the dialog + its "Adding…" spinner up until the parent list has
      // reloaded, so the user sees work is happening (not an instant close).
      await onAdded();
      onClose();
    } catch (err) {
      host.toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setAdding(false);
    }
  };

  const newCount = rows ? rows.filter((r) => !r.alreadyAdded && selected.has(r.fullName)).length : 0;

  return (
    <Dialog title="Suggested for you" icon={<Sparkles size={14} />} onClose={onClose} busy={adding} wide>
      <div className="prm-modal-body">
        <p className="prm-field-hint" style={{ marginBottom: '12px' }}>
          Repositories where you authored or reviewed PRs in the last 90 days.
        </p>
        {rows === null ? (
          <div className="prm-loading">
            <Loader2 size={14} className="prm-spin" /> Looking at your activity in the last 90 days…
          </div>
        ) : error ? (
          <div className="prm-modal-error">{error}</div>
        ) : rows.length === 0 ? (
          <div className="prm-area-empty">
            No repositories found in your last 90 days of activity. To monitor a repository, author or review a
            pull request in it, then Rescan — or close this dialog and add repositories manually via{' '}
            <strong>Add repository manually</strong>.
          </div>
        ) : (
          <div className="prm-suggested-list">
            {rows.map((r) => (
              <label key={r.fullName} className="prm-suggested-row">
                <input
                  type="checkbox"
                  checked={selected.has(r.fullName)}
                  disabled={r.alreadyAdded}
                  onChange={() => toggle(r)}
                />
                <span className="prm-suggested-main">
                  <span className="prm-entity-title">{r.fullName}</span>
                  <span className="prm-entity-sub">
                    {r.prCount} PRs · {formatRelative(r.lastActivity)}
                  </span>
                </span>
                {r.alreadyAdded && (
                  <span className="prm-suggested-added">
                    <CircleCheck size={13} /> Already added
                  </span>
                )}
              </label>
            ))}
          </div>
        )}
      </div>
      <footer className="prm-modal-footer">
        <button type="button" className="prm-btn" onClick={() => void scan()} disabled={adding || rows === null}>
          <Sparkles size={13} /> <span>Rescan</span>
        </button>
        <button type="button" className="prm-btn" onClick={onClose} disabled={adding}>
          Cancel
        </button>
        <button
          type="button"
          className="prm-btn prm-btn--primary"
          onClick={() => void addSelected()}
          disabled={adding || newCount === 0}
        >
          {adding ? <Loader2 size={13} className="prm-spin" /> : null}
          <span>{adding ? 'Adding…' : newCount > 0 ? `Add ${newCount} Selected` : 'Add Selected'}</span>
        </button>
      </footer>
    </Dialog>
  );
}

// ── Browse Repositories (R-REPO-009) ──────────────────────────────────────────

// Show-all-on-open, across EVERY authenticated host at once (CodeNod parity).
// There is NO per-org dropdown: "orgs" in this extension mirror `gh` accounts
// (users), so a per-org browse degrades to personal repos (the "Browse only
// showed my personal repos" bug). On open we call main's `listAllRepositories`,
// which fans `user/repos?affiliation=owner,collaborator,organization_member`
// across each authenticated host and merges — the union that reaches every org
// the user belongs to. The search box then FILTERS the already-loaded list
// client-side (no per-keystroke gh call); "Load more" pages deeper. Repos that
// are already monitored render a "Connected" pill instead of a checkbox.

function BrowseDialog({
  host,
  onClose,
  onAdded,
}: {
  host: ModuleHost;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [query, setQuery] = useState('');
  const [repos, setRepos] = useState<RemoteRepo[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Owners whose group is cut mid-stream (more repos live in an unloaded batch).
  // Their count renders with a trailing "…" so the user knows to Load more
  // (AC-REPO-9.5). Overwritten each load: the latest batch's frontier is the
  // current incomplete set — a prior frontier owner is completed by the next batch.
  const [incompleteOwners, setIncompleteOwners] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);

  interface ListResult {
    ok: boolean;
    repos?: RemoteRepo[];
    hasMore?: boolean;
    incompleteOwners?: string[];
    error?: string;
  }

  // Load ALL accessible repos on open (page 1). Dedupe across pages by host+name.
  const loadPage = useCallback(
    async (pageNum: number, append: boolean) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await host.call<ListResult>('listAllRepositories', { page: pageNum });
        const rows = res?.ok && Array.isArray(res.repos) ? res.repos : [];
        setHasMore(!!res?.hasMore);
        setIncompleteOwners(new Set(Array.isArray(res?.incompleteOwners) ? res.incompleteOwners : []));
        setRepos((prev) => {
          if (!append || !prev) return rows;
          const seen = new Set(prev.map((r) => `${r.host}|${r.fullName}`));
          return [...prev, ...rows.filter((r) => !seen.has(`${r.host}|${r.fullName}`))];
        });
        if (res && res.ok === false && res.error) setError(res.error);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        if (!append) setRepos([]);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [host]
  );

  useEffect(() => {
    void loadPage(1, false);
  }, [loadPage]);

  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    void loadPage(next, true);
  };

  const all = repos ?? [];

  // Client-side filter: the search box narrows the already-loaded list by a
  // case-insensitive substring on `owner/repo` — no per-keystroke gh call.
  const q = query.trim().toLowerCase();
  const shown = q ? all.filter((r) => r.fullName.toLowerCase().includes(q)) : all;

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleGroup = (owner: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(owner)) next.delete(owner);
      else next.add(owner);
      return next;
    });
  };

  // A repo can share a fullName across hosts, so key selection by host+fullName.
  const repoKey = (r: RemoteRepo) => `${r.host}|${r.fullName}`;

  // Group the shown repos by owner (AC-REPO-9.1), preserving first-seen order.
  const groups = (() => {
    const map = new Map<string, RemoteRepo[]>();
    for (const r of shown) {
      const list = map.get(r.owner) ?? [];
      list.push(r);
      map.set(r.owner, list);
    }
    return Array.from(map.entries());
  })();

  const addSelected = async () => {
    // Never re-add an already-monitored repo, even if somehow selected.
    const toAdd = shown.filter((r) => !r.alreadyAdded && selected.has(repoKey(r)));
    if (toAdd.length === 0) return;
    setAdding(true);
    try {
      await host.call('addRepositories', {
        repos: toAdd.map((r) => ({ owner: r.owner, repo: r.repo, host: r.host, orgLogin: r.owner })),
      });
      // Keep the dialog + its "Adding…" spinner up until the parent list has
      // reloaded, so the user sees work is happening (not an instant close).
      await onAdded();
      onClose();
    } catch (err) {
      host.toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setAdding(false);
    }
  };

  const selectedCount = shown.filter((r) => !r.alreadyAdded && selected.has(repoKey(r))).length;

  return (
    <Dialog
      title="Browse Repositories"
      icon={<FolderSearch size={14} />}
      onClose={onClose}
      busy={adding}
      wide
    >
      <div className="prm-modal-body">
        <div className="prm-browse-controls">
          <input
            type="text"
            className="prm-input"
            placeholder="Filter repositories across all your organizations…"
            value={query}
            spellCheck={false}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {error && <div className="prm-modal-error">{error}</div>}

        {loading ? (
          <div className="prm-loading">
            <Loader2 size={14} className="prm-spin" /> Loading repositories…
          </div>
        ) : (
          <div className="prm-browse-list">
            {groups.map(([owner, rows]) => {
              const open = !collapsed.has(owner);
              return (
                <div key={owner} className="prm-browse-group">
                  <button
                    type="button"
                    className="prm-browse-group-header"
                    onClick={() => toggleGroup(owner)}
                    aria-expanded={open}
                  >
                    <ChevronRight
                      size={13}
                      className={`prm-disclosure${open ? ' is-open' : ''}`}
                      aria-hidden
                    />
                    <span className="prm-browse-group-name">{owner}</span>
                    <span
                      className="prm-browse-group-count"
                      title={
                        !q && incompleteOwners.has(owner)
                          ? `${rows.length} loaded — more available, use Load more`
                          : undefined
                      }
                    >
                      ({rows.length}
                      {!q && incompleteOwners.has(owner) ? '…' : ''})
                    </span>
                  </button>
                  {open &&
                    rows.map((r) =>
                      r.alreadyAdded ? (
                        <div key={repoKey(r)} className="prm-checkbox-row prm-browse-repo-row prm-browse-repo-row--added">
                          <span>
                            <GitBranch size={13} aria-hidden /> {r.fullName}
                            {r.isPrivate && <span className="prm-added-tag"> · private</span>}
                          </span>
                          <span className="prm-conn-pill prm-conn-pill--connected">
                            <CircleCheck size={11} aria-hidden /> Connected
                          </span>
                        </div>
                      ) : (
                        <label key={repoKey(r)} className="prm-checkbox-row prm-browse-repo-row">
                          <input
                            type="checkbox"
                            checked={selected.has(repoKey(r))}
                            onChange={() => toggle(repoKey(r))}
                          />
                          <span>
                            <GitBranch size={13} aria-hidden /> {r.fullName}
                            {r.isPrivate && <span className="prm-added-tag"> · private</span>}
                          </span>
                        </label>
                      )
                    )}
                </div>
              );
            })}
            {shown.length === 0 && (
              <div className="prm-area-empty">
                {q ? 'No repositories match your filter.' : 'No repositories found.'}
              </div>
            )}
            {hasMore && !q && (
              <button
                type="button"
                className="prm-btn prm-browse-load-more"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? <Loader2 size={13} className="prm-spin" /> : null}
                <span>{loadingMore ? 'Loading…' : 'Load more'}</span>
              </button>
            )}
          </div>
        )}
      </div>
      <footer className="prm-modal-footer">
        <button type="button" className="prm-btn" onClick={onClose} disabled={adding}>
          Cancel
        </button>
        <button
          type="button"
          className="prm-btn prm-btn--primary"
          onClick={() => void addSelected()}
          disabled={adding || selectedCount === 0}
        >
          {adding ? <Loader2 size={13} className="prm-spin" /> : null}
          <span>{selectedCount > 0 ? `Add ${selectedCount} Selected` : 'Add Selected'}</span>
        </button>
      </footer>
    </Dialog>
  );
}

// ── Repository Settings (R-REPO-011) ──────────────────────────────────────────

function RepoSettingsDialog({
  host,
  repo,
  orgs,
  initialTab = 'general',
  onClose,
  onSaved,
}: {
  host: ModuleHost;
  repo: RepoRow;
  orgs: OrgRow[];
  initialTab?: RepoSettingsTab;
  onClose: () => void;
  onSaved: (prs?: MonitoredPr[]) => void;
}) {
  const [tab, setTab] = useState<RepoSettingsTab>(initialTab);
  const [ref, setRef] = useState(`${repo.owner}/${repo.repo}`);
  const [orgLogin, setOrgLogin] = useState(repo.orgLogin);
  const [active, setActive] = useState(repo.active);
  // Build preset: new field → legacy `tisPreset` → default (OQ-7 migration-free).
  const [buildTisPreset, setBuildTisPreset] = useState<TisPresetId>(
    repo.buildTisPreset ?? repo.tisPreset ?? DEFAULT_TIS_PRESET
  );
  const [reviewTisPreset, setReviewTisPreset] = useState<TisPresetId>(
    repo.reviewTisPreset ?? DEFAULT_REVIEW_TIS_PRESET
  );
  const [sfciGated, setSfciGated] = useState(repo.sfciGated === true);
  // Single UI toggle backs a `ignoredFailingChecks` list: on → ['Snyk'], off → [].
  const [ignoreSnyk, setIgnoreSnyk] = useState(
    (repo.ignoredFailingChecks ?? []).some((e) => e.toLowerCase().includes('snyk'))
  );
  const [notifyInApp, setNotifyInApp] = useState(repo.notifyInApp ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const orgsOnHost = orgs.filter((o) => o.host === repo.host);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await host.call<{ ok: boolean; error?: string; prs?: MonitoredPr[] }>('updateRepository', {
        key: { host: repo.host, owner: repo.owner, repo: repo.repo },
        ref: ref.trim(),
        orgLogin,
        active,
        buildTisPreset,
        reviewTisPreset,
        sfciGated,
        ignoredFailingChecks: ignoreSnyk ? ['Snyk'] : [],
        notifyInApp,
      });
      // A status-affecting change (sfciGated / ignored checks) makes main re-run
      // the poll for this repo and return refreshed PRs — hand them up so the
      // panel's live board updates without waiting for the next sync.
      if (res?.ok) onSaved(res.prs);
      else setError(res?.error || 'Failed to save settings.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={
        <span className="prm-dialog-title">
          Repository Settings <span className="prm-entity-sub">{repo.owner}/{repo.repo}</span>
        </span>
      }
      icon={<Edit2 size={14} />}
      onClose={onClose}
      busy={busy}
    >
      <nav className="prm-dialog-tabs">
        <button
          type="button"
          className={`prm-dialog-tab${tab === 'general' ? ' active' : ''}`}
          onClick={() => setTab('general')}
        >
          <Edit2 size={12} /> General
        </button>
        <button
          type="button"
          className={`prm-dialog-tab${tab === 'status' ? ' active' : ''}`}
          onClick={() => setTab('status')}
        >
          <Clock size={12} /> Status
        </button>
        <button
          type="button"
          className={`prm-dialog-tab${tab === 'notifications' ? ' active' : ''}`}
          onClick={() => setTab('notifications')}
        >
          <Bell size={12} /> Notifications
        </button>
      </nav>

      <div className="prm-modal-body">
        {tab === 'general' ? (
          <>
            {/* "Repository is active" is the primary decision — surface it first (AC-REPO-11). */}
            <label className="prm-checkbox-row">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              <span>
                <strong>Repository is active</strong>
                <small>Inactive repositories won't surface new PRs.</small>
              </span>
            </label>
            <label className="prm-field">
              <span className="prm-field-label prm-field-label--strong">Repository</span>
              <span className="prm-field-hint">Format: owner/repo (e.g., facebook/react)</span>
              <input
                type="text"
                className="prm-input"
                value={ref}
                spellCheck={false}
                onChange={(e) => setRef(e.target.value)}
              />
            </label>
            <label className="prm-field">
              <span className="prm-field-label prm-field-label--strong">Organization</span>
              <span className="prm-field-hint">The GitHub account this repository belongs to.</span>
              <select
                className="prm-input prm-input--select"
                value={orgLogin}
                onChange={(e) => setOrgLogin(e.target.value)}
              >
                {orgsOnHost.map((o) => (
                  <option key={o.login} value={o.login}>
                    {o.login} ({o.shortHost})
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : tab === 'status' ? (
          <>
            {/* 1. Build-phase preset (hours) — Jenkins/CI time before build stalls. */}
            <label className="prm-field">
              <span className="prm-field-label prm-field-label--strong">Build-phase preset</span>
              <span className="prm-field-hint">
                Jenkins/CI time before the build pill is considered stalled (hours).
              </span>
              <select
                className="prm-input prm-input--select"
                value={buildTisPreset}
                onChange={(e) => setBuildTisPreset(e.target.value as TisPresetId)}
              >
                {Object.values(TIS_PRESETS).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} ({p.warnHours}h / {p.dangerHours}h)
                  </option>
                ))}
              </select>
            </label>

            {/* 2. Review-phase preset (days) — review wait before stall; Draft excluded. */}
            <label className="prm-field">
              <span className="prm-field-label prm-field-label--strong">Review-phase preset</span>
              <span className="prm-field-hint">
                Review wait before the review pill is considered stalled (days). Drafts are excluded.
              </span>
              <select
                className="prm-input prm-input--select"
                value={reviewTisPreset}
                onChange={(e) => setReviewTisPreset(e.target.value as TisPresetId)}
              >
                {Object.values(REVIEW_TIS_PRESETS).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} ({p.warnDays}d / {p.dangerDays}d)
                  </option>
                ))}
              </select>
            </label>

            {/* 3. SFCI Gated Repo — build/merge runs through the tok-gimlet SFCI job. */}
            <label className="prm-checkbox-row">
              <input type="checkbox" checked={sfciGated} onChange={(e) => setSfciGated(e.target.checked)} />
              <span>
                <strong>SFCI Gated Repo</strong>
                <small>
                  Build + merge run through the tok-gimlet SFCI job with manual action steps. A build
                  only stalls after the SFCI-job comment appears; merge-stall reflects the pending action.
                </small>
              </span>
            </label>

            {/* 4. Ignore Snyk failures — a failing Snyk check counts as pass for build status. */}
            <label className="prm-checkbox-row">
              <input type="checkbox" checked={ignoreSnyk} onChange={(e) => setIgnoreSnyk(e.target.checked)} />
              <span>
                <strong>Ignore Snyk failures for build status</strong>
                <small>
                  A failing "Snyk" check counts as passing for build/merge status only. The status badge
                  still shows Failing.
                </small>
              </span>
            </label>
          </>
        ) : (
          <label className="prm-checkbox-row">
            <input
              type="checkbox"
              checked={notifyInApp}
              onChange={(e) => setNotifyInApp(e.target.checked)}
            />
            <span>
              <strong>In-app notifications</strong>
              <small>Show notifications for status changes on this repository.</small>
            </span>
          </label>
        )}
        {error && <div className="prm-modal-error">{error}</div>}
      </div>
      <footer className="prm-modal-footer">
        <button type="button" className="prm-btn" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="prm-btn prm-btn--primary" onClick={() => void save()} disabled={busy}>
          {busy ? <Loader2 size={13} className="prm-spin" /> : null}
          <span>Save Settings</span>
        </button>
      </footer>
    </Dialog>
  );
}

// ── Test Connection (R-REPO-010) ──────────────────────────────────────────────

function TestConnectionDialog({
  host,
  repo,
  onClose,
  onResult,
}: {
  host: ModuleHost;
  repo: RepoRow;
  onClose: () => void;
  onResult?: (ok: boolean) => void;
}) {
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await host.call<{ ok: boolean; error?: string }>('testRepository', {
          host: repo.host,
          owner: repo.owner,
          repo: repo.repo,
        });
        const settled = res ?? { ok: false, error: 'No response' };
        if (alive) {
          setResult(settled);
          onResult?.(settled.ok);
        }
      } catch (err) {
        if (alive) {
          setResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
          onResult?.(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, repo]);

  return (
    <Dialog
      title={`Connection Test Results: ${repo.owner}/${repo.repo}`}
      icon={<Wifi size={14} />}
      onClose={onClose}
    >
      <div className="prm-modal-body">
        {result === null ? (
          <div className="prm-loading">
            <Wifi size={14} className="prm-spin" /> Testing connection…
          </div>
        ) : result.ok ? (
          <div className="prm-test-result prm-test-result--ok">
            <CircleCheck size={16} /> All connection tests passed.
          </div>
        ) : (
          <div className="prm-test-result prm-test-result--fail">
            <CircleX size={16} />
            <div>
              <div>{result.error || 'Connection failed.'}</div>
              <div className="prm-field-hint">
                Try <code>gh auth login {repo.host}</code> in a terminal, then test again.
              </div>
            </div>
          </div>
        )}
      </div>
      <footer className="prm-modal-footer">
        <button type="button" className="prm-btn" onClick={onClose}>
          Close
        </button>
      </footer>
    </Dialog>
  );
}
