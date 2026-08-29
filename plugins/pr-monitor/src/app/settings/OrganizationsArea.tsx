/**
 * Organizations area (R-ORG-*). The org list MIRRORS the authenticated `gh`
 * accounts — there is no manual Add/Edit (R-ORG-001); the user can only Delete
 * an org (removes it + its repos + their PRs, leaves gh creds untouched —
 * R-ORG-006) or Re-discover to repopulate from `gh` (R-ORG-004). Discovery is
 * seeded once-ever main-side (R-ORG-002 anti-loop), so a deleted org does not
 * silently reappear on the next list.
 */

import { useCallback, useEffect, useState } from 'react';
import { Sparkles, Trash2, Loader2, HelpCircle } from 'lucide-react';
import type { ModuleHost } from '../host.js';
import { type ConnectionState, type MonitoredOrg, PREFETCH_ORGS_CACHE_KEY } from '../../../lib/types.js';
import { AreaHeader, ConnectionPill, ConfirmDialog, Dialog } from './ui.js';

type OrgRow = MonitoredOrg & { shortHost: string; connection: ConnectionState };

export function OrganizationsArea({ host }: { host: ModuleHost }) {
  // Paint from the background-prefetched cache if it's warm (R-SET-005), so the
  // first open skips the gh-backed loading spinner. `load()` still refreshes.
  const [orgs, setOrgs] = useState<OrgRow[] | null>(() => {
    const cached = host.cache.get<{ ok?: boolean; orgs?: OrgRow[] }>(PREFETCH_ORGS_CACHE_KEY);
    return cached?.ok && Array.isArray(cached.orgs) ? cached.orgs : null;
  });
  const [error, setError] = useState<string | null>(null);
  const [rediscovering, setRediscovering] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<OrgRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await host.call<{ ok: boolean; orgs?: OrgRow[]; error?: string }>('listOrgs');
      if (res?.ok && Array.isArray(res.orgs)) {
        setOrgs(res.orgs);
        setError(null);
      } else {
        setOrgs([]);
        if (res?.error) setError(res.error);
      }
    } catch (err) {
      setOrgs([]);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [host]);

  useEffect(() => {
    void load();
  }, [load]);

  const rediscover = async () => {
    setRediscovering(true);
    setError(null);
    try {
      const res = await host.call<{ ok: boolean; error?: string }>('rediscoverOrgs');
      if (!res?.ok && res?.error) setError(res.error);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRediscovering(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const res = await host.call<{ ok: boolean; error?: string }>('deleteOrg', {
        host: pendingDelete.host,
        login: pendingDelete.login,
      });
      if (!res?.ok && res?.error) {
        host.toast(res.error, 'error');
      }
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
        title="Organizations"
        subtitle="This list mirrors the GitHub accounts you are signed into."
        actions={
          <>
            <button
              type="button"
              className="prm-btn"
              onClick={() => void rediscover()}
              disabled={rediscovering}
              title="Re-discover organizations from your gh accounts"
            >
              {rediscovering ? <Loader2 size={13} className="prm-spin" /> : <Sparkles size={13} />}
              <span>Re-discover</span>
            </button>
            <button
              type="button"
              className="prm-row-icon-btn"
              onClick={() => setHelpOpen(true)}
              title="How to add or remove organizations"
              aria-label="How to add or remove organizations"
            >
              <HelpCircle size={16} />
            </button>
          </>
        }
      />

      {error && <div className="prm-error">{error}</div>}

      {orgs === null ? (
        <div className="prm-loading">
          <Loader2 size={14} className="prm-spin" /> Loading organizations…
        </div>
      ) : orgs.length === 0 ? (
        <div className="prm-area-empty">
          No organizations found. Sign in with <code>gh auth login</code>, then Re-discover.
        </div>
      ) : (
        <div className="prm-card-list">
          {orgs.map((o) => (
            <div key={`${o.host}|${o.login}`} className="prm-entity-card">
              <div className="prm-entity-main">
                <div className="prm-entity-title">
                  {o.login} <span className="prm-entity-host">({o.shortHost})</span>
                </div>
                <div className="prm-entity-sub">{o.apiBaseUrl}</div>
                <div className="prm-entity-sub">
                  Authenticated as <code>{o.login}</code>
                </div>
              </div>
              <div className="prm-entity-side">
                {/* AC-ORG-5.3: while a Re-discover is in flight, each card shows the
                    transient "Checking…" pill until listOrgs resolves the fresh state. */}
                <ConnectionPill state={rediscovering ? 'checking' : o.connection} />
                <button
                  type="button"
                  className="prm-row-icon-btn prm-row-icon-btn--danger"
                  onClick={() => setPendingDelete(o)}
                  title="Delete organization"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {helpOpen && (
        <Dialog
          title="Adding & removing organizations"
          icon={<HelpCircle size={16} />}
          onClose={() => setHelpOpen(false)}
        >
          <div className="prm-modal-body prm-help-body">
            <p>
              PR Monitor does not add organizations directly — the list mirrors the GitHub
              accounts the <code>gh</code> CLI is signed into. To change it:
            </p>
            <ul>
              <li>
                <strong>Add</strong> an account: run <code>gh auth login</code> in a terminal and
                follow the prompts.
              </li>
              <li>
                <strong>Remove</strong> an account: run <code>gh auth logout</code>.
              </li>
              <li>
                Then click <strong>Re-discover</strong> here to refresh the list.
              </li>
            </ul>
            <p>
              Deleting an organization from this screen only removes it (and its repos/PRs) from
              PR Monitor — your <code>gh</code> credentials are left untouched.
            </p>
          </div>
          <footer className="prm-modal-footer">
            <button type="button" className="prm-btn prm-btn--primary" onClick={() => setHelpOpen(false)}>
              <span>Got it</span>
            </button>
          </footer>
        </Dialog>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete organization?"
          danger
          busy={deleting}
          message={
            <>
              Delete <strong>{pendingDelete.login}</strong> ({pendingDelete.shortHost})? Its
              connected repositories and their monitored PRs will also be removed from PR Monitor.
              Your <code>gh</code> credentials are left untouched.
            </>
          }
          confirmLabel="Delete"
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
