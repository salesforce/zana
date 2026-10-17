import { useCallback, useEffect, useRef, useState } from 'react';
import type { PeerLink, PeerLinkState } from '@zana-ai/zcc-server-contract';
import { Section } from '@/components/settings/FormFields';
import { peerLinks } from '../../lib/product-client.js';
import { SearchTarget } from './MachineCard.js';
import './peers-settings.css';

const STATE_LABELS: Record<PeerLinkState, string> = {
  'pre-consent': 'Awaiting approval',
  activating: 'Activating',
  linked: 'Linked',
  removed: 'Removed',
  failed: 'Failed',
  unclaimed: 'Unclaimed'
};

type Pending = { kind: 'use'; hostId: string; pluginId: string; scope: string } | { kind: 'link'; hostId: string };

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Request failed';
}

function sinceText(since: number): string {
  const date = new Date(since);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
}

/**
 * Generic Peers hub. Lists every plugin link and the uses that justify it. The view
 * never names a plugin: labels come from the server's registry, and removal is an
 * owner gesture the server re-validates.
 */
export function PeersSettingsView() {
  const [links, setLinks] = useState<PeerLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const disposed = useRef(false);

  const load = useCallback(async (keepError = false) => {
    try {
      const body = await peerLinks.list();
      if (!disposed.current) { setLinks(Array.isArray(body?.links) ? body.links : []); if (!keepError) setError(null); }
    } catch (failure) {
      if (!disposed.current) setError(errorText(failure));
    }
  }, []);

  useEffect(() => {
    disposed.current = false;
    void load();
    return () => { disposed.current = true; };
  }, [load]);

  const run = async (key: string, action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(key);
    setConfirming(null);
    try {
      await action();
      setError(null);
    } catch (failure) {
      if (!disposed.current) setError(errorText(failure));
    } finally {
      if (!disposed.current) setBusy(null);
      await load(true);
    }
  };

  const removeUse = (target: Extract<Pending, { kind: 'use' }>) =>
    run(`use:${target.hostId}:${target.pluginId}:${target.scope}`, () => peerLinks.removeUse(target.hostId, target.pluginId, target.scope));
  const removeLink = (hostId: string) => run(`link:${hostId}`, () => peerLinks.removeLink(hostId));
  const disconnect = (hostId: string) => run(`pause:${hostId}`, () => peerLinks.disconnect(hostId));
  const reconnect = (hostId: string) => run(`resume:${hostId}`, () => peerLinks.reconnect(hostId));

  return (
    <Section
      anchorId="peers"
      searchId="peers.links"
      title="Peers"
      help="Links to other Zana installs. Each link exists only because a plugin uses it, and these links cannot run work on this machine."
    >
      {error && <p className="peers-error" role="alert">{error}</p>}
      {links === null && !error && <p className="peers-loading" role="status">Loading links…</p>}
      {links !== null && links.length === 0 && (
        <SearchTarget searchId="peers.empty" block><p className="peers-empty">No peer links yet. They appear here when a plugin connects this install to another one.</p></SearchTarget>
      )}
      {links !== null && links.length > 0 && (
        <SearchTarget searchId="peers.link-list" block>
          <ul className="peers-list" aria-label="Peer links">
            {links.map((link) => (
              <li key={link.hostId} className="peers-link" data-testid="peer-link">
                <div className="peers-link-header">
                  <h4 className="peers-link-name">{link.peerName}</h4>
                  <div className="peers-link-statuses">
                    <span className="peers-state" data-state={link.state} role="status">{STATE_LABELS[link.state] ?? link.state}</span>
                    {link.paused ? <span className="peers-state" data-state="paused" role="status">Paused</span>
                      : link.connected && <span className="peers-state" data-state="connected" role="status">Connected</span>}
                  </div>
                  <div className="peers-link-actions">
                    {confirming === link.hostId ? (
                      <>
                        <span className="peers-confirm-text">Delete this link for all plugins and remove this machine&apos;s access?</span>
                        <button type="button" className="btn danger" disabled={busy !== null} onClick={() => void removeLink(link.hostId)}>Confirm remove</button>
                        <button type="button" className="btn" onClick={() => setConfirming(null)}>Keep link</button>
                      </>
                    ) : (
                      <>
                        {link.state === 'linked' && (link.paused || !link.connected ? (
                          <button type="button" className="btn peers-btn-secondary" disabled={busy !== null} onClick={() => void reconnect(link.hostId)}>Reconnect</button>
                        ) : (
                          <button type="button" className="btn peers-btn-secondary" disabled={busy !== null} onClick={() => void disconnect(link.hostId)}>Disconnect</button>
                        ))}
                        <button type="button" className="btn peers-btn-remove" disabled={busy !== null} onClick={() => setConfirming(link.hostId)}>Remove link</button>
                      </>
                    )}
                  </div>
                </div>
                {link.reason && <p className="peers-reason">{link.reason}</p>}
                {link.uses.length === 0 ? (
                  <p className="peers-empty">No plugin uses this link.</p>
                ) : (
                  <ul className="peers-uses" aria-label="Plugin uses">
                    {link.uses.map((use) => {
                      const key = `use:${link.hostId}:${use.pluginId}:${use.scope}`;
                      return (
                        <li key={key} className="peers-use" data-testid="peer-link-use">
                          <span className="peers-use-label">{use.label}</span>
                          {use.note && (
                            <span className="peers-state" data-state={use.note.state === 'attention' ? 'attention' : 'ok'} data-testid="peer-use-note" role="status" title={use.note.detail}>
                              {use.note.label}
                            </span>
                          )}
                          <span className="peers-use-meta" title={use.scope}>{use.scope} · since {sinceText(use.since)}</span>
                          {use.note?.detail && <span className="peers-note-detail">{use.note.detail}</span>}
                          {link.uses.length > 1 && (
                            <button
                              type="button"
                              className="btn"
                              disabled={busy !== null}
                              aria-label={`Stop syncing ${use.label}`}
                              onClick={() => void removeUse({ kind: 'use', hostId: link.hostId, pluginId: use.pluginId, scope: use.scope })}
                            >
                              Stop syncing
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </SearchTarget>
      )}
    </Section>
  );
}
