import { useCallback, useEffect, useRef, useState } from 'react';
import type { PeerConnection, PeerLink, PeerLinkHookFailure, PeerLinkState, RemovePeerLinkResult } from '@zana-ai/zcc-server-contract';
import type { PluginAppEntry } from '@zana-ai/zcc-domain/product';
import { peerConnections, peerLinks, product, type PeerLeftover } from '../../lib/product-client.js';
import { SearchTarget } from './MachineCard.js';
import { AddComputer } from './peers/AddComputer.js';
import { JoinComputer } from './peers/JoinComputer.js';
import { PeerDialog } from './peers/PeerDialog.js';
import { ActiveUseConfirm, HookFailureDialog, RemovePluginsConfirm } from './peers/RemovalDialogs.js';
import { LeftoverAccess, StuckStateActions, forceRemoveText, type StuckAction } from './peers/StuckState.js';
import './peers-settings.css';

const TERMINAL_CONNECTION_STATES = new Set<PeerConnection['state']>(['ready', 'denied', 'cancelled', 'expired', 'failed']);
const CANCELLABLE_CONNECTION_STATES = new Set<PeerConnection['state']>(['open', 'redeeming', 'reserved']);
const CONNECTION_POLL_MS = 2000;


const STATE_LABELS: Record<PeerLinkState, string> = {
  'pre-consent': 'Awaiting approval',
  activating: 'Activating',
  linked: 'Linked',
  removed: 'Removed',
  failed: 'Failed',
  unclaimed: 'Unclaimed'
};

type ActiveEntry = { pluginId: string; label: string };
type Flow =
  | { kind: 'link'; hostId: string; step: 'confirm' }
  | { kind: 'link'; hostId: string; step: 'force' }
  | { kind: 'link'; hostId: string; step: 'failed'; failures: PeerLinkHookFailure[] }
  | { kind: 'use'; key: string };

type Group = { id: string; name: string; links: PeerLink[] };

/** Group links by computer; two computers sharing a name get a short id suffix. */
function groupLinks(links: PeerLink[]): Group[] {
  const byId = new Map<string, PeerLink[]>();
  for (const link of links) {
    const id = link.peerInstanceId ?? link.hostId;
    byId.set(id, [...(byId.get(id) ?? []), link]);
  }
  const nameCount = new Map<string, number>();
  for (const items of byId.values()) nameCount.set(items[0]!.peerName, (nameCount.get(items[0]!.peerName) ?? 0) + 1);
  return [...byId].map(([id, items]) => {
    const name = items[0]!.peerName;
    return { id, name: (nameCount.get(name) ?? 0) > 1 ? `${name} (${id.slice(0, 8)})` : name, links: items };
  });
}

function LinkStatuses({ link }: { link: PeerLink }) {
  const stateLabel = link.state === 'linked' ? null : STATE_LABELS[link.state] ?? link.state;
  return (
    <div className="peers-link-statuses">
      {stateLabel && <span className="peers-state" data-state={link.state} role="status">{stateLabel}</span>}
      {link.paused ? <span className="peers-state" data-state="paused" role="status">Paused</span>
        : link.connected && <span className="peers-state" data-state="connected" role="status">Connected</span>}
    </div>
  );
}

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
  const [flow, setFlow] = useState<Flow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const disposed = useRef(false);
  const [connections, setConnections] = useState<PeerConnection[]>([]);
  const [leftovers, setLeftovers] = useState<PeerLeftover[]>([]);
  const [panel, setPanel] = useState<'add' | 'join' | null>(null);
  const [plugins, setPlugins] = useState<PluginAppEntry[] | null>(null);

  const loadConnections = useCallback(async () => {
    try {
      const body = await peerConnections.list();
      if (!disposed.current) setConnections(Array.isArray(body?.connections) ? body.connections : []);
    } catch {
      // Polling is best effort; the next tick retries.
    }
  }, []);

  // Best effort: a failed fetch hides the section rather than raising an error.
  const loadLeftovers = useCallback(async () => {
    try {
      const body = await peerLinks.leftovers();
      if (!disposed.current) setLeftovers(Array.isArray(body?.leftovers) ? body.leftovers : []);
    } catch {
      if (!disposed.current) setLeftovers([]);
    }
  }, []);

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
    void loadConnections();
    void loadLeftovers();
    product.pluginApps.list().then((next) => {
      if (!disposed.current) setPlugins(next);
    }).catch(() => {
      if (!disposed.current) setPlugins([]);
    });
    const offPlugins = product.pluginApps.onChanged((next) => {
      if (!disposed.current) setPlugins(next);
    });
    // A torn-down link destroys its host after its connection is already terminal (polling has stopped), so host changes reload the list.
    const offHosts = product.hosts.onChanged(() => {
      if (!disposed.current) void load(true);
    });
    return () => { disposed.current = true; offPlugins(); offHosts(); };
  }, [load, loadConnections, loadLeftovers]);

  const hasActiveConnection = connections.some((connection) => !TERMINAL_CONNECTION_STATES.has(connection.state));
  useEffect(() => {
    if (!hasActiveConnection) return undefined;
    const timer = setInterval(() => { void loadConnections(); }, CONNECTION_POLL_MS);
    return () => clearInterval(timer);
  }, [hasActiveConnection, loadConnections]);

  // A connection reaching a new state (consented, ready, ...) creates or advances a link; reload the link list so it shows.
  const connectionStates = connections.map((connection) => `${connection.invitationId}:${connection.state}`).join(',');
  const seenStates = useRef<string | null>(null);
  useEffect(() => {
    const previous = seenStates.current;
    seenStates.current = connectionStates;
    if (previous !== null && previous !== connectionStates) void load(true);
  }, [connectionStates, load]);

  const groups = links ? groupLinks(links) : [];
  const hasPeerPlugin = plugins?.some((plugin) => plugin.enabled && plugin.peers) ?? false;
  const refreshAll = useCallback(() => { void loadConnections(); void load(true); }, [loadConnections, load]);
  const cancelConnection = (invitationId: string) => run(`cancel:${invitationId}`, async () => {
    await peerConnections.cancel(invitationId);
    await loadConnections();
  });
  const inProgress = connections.filter((connection) => !TERMINAL_CONNECTION_STATES.has(connection.state));

  const run = async (key: string, action: () => Promise<unknown>): Promise<unknown> => {
    if (busy) return undefined;
    setBusy(key);
    setFlow(null);
    let result: unknown;
    try {
      result = await action();
      setError(null);
    } catch (failure) {
      if (!disposed.current) setError(errorText(failure));
    } finally {
      if (!disposed.current) setBusy(null);
      await load(true);
    }
    return result;
  };

  // Activity is advisory: a failed lookup must never block Stop/Remove.
  const fetchActive = async (hostId: string): Promise<ActiveEntry[]> => {
    try {
      const body = await peerLinks.activity(hostId);
      return Array.isArray(body?.active) ? body.active : [];
    } catch {
      return [];
    }
  };
  const startStopUse = async (hostId: string, pluginId: string, scope: string, key: string) => {
    const active = await fetchActive(hostId);
    if (disposed.current) return;
    if (active.some((entry) => entry.pluginId === pluginId)) setFlow({ kind: 'use', key });
    else await removeUse({ kind: 'use', hostId, pluginId, scope });
  };

  const removeUse = (target: Extract<Pending, { kind: 'use' }>) =>
    run(`use:${target.hostId}:${target.pluginId}:${target.scope}`, () => peerLinks.removeUse(target.hostId, target.pluginId, target.scope));
  const removeLink = async (hostId: string, force = false) => {
    const result = (await run(`link:${hostId}`, () => (force ? peerLinks.removeLink(hostId, { force: true }) : peerLinks.removeLink(hostId)))) as RemovePeerLinkResult | undefined;
    if (result && result.ok === false && !disposed.current) setFlow({ kind: 'link', hostId, step: 'failed', failures: result.hookFailures });
    await loadLeftovers();
  };
  const forgetLeftover = async (computerId: string) => {
    await run(`forget:${computerId}`, () => peerLinks.forgetLeftover(computerId));
    await loadLeftovers();
  };
  const stuckAction = (link: PeerLink, action: StuckAction) => {
    if (action === 'reconnect') return repair(link.hostId);
    if (action === 'retry') return link.state === 'linked' ? repair(link.hostId) : run(`retry:${link.hostId}`, async () => undefined);
    if (action === 'remove-anyway') { setFlow({ kind: 'link', hostId: link.hostId, step: 'force' }); return undefined; }
    return undefined;
  };
  const pause = (hostId: string) => run(`pause:${hostId}`, () => peerLinks.disconnect(hostId));
  const resume = (hostId: string) => run(`resume:${hostId}`, () => peerLinks.reconnect(hostId));
  const repair = (hostId: string) => run(`repair:${hostId}`, () => peerLinks.repair(hostId));

  return (
    <div id="settings-anchor-peers" data-settings-target="peers.links" className="peers-page">
      <h3 className="peers-page-title">Peers</h3>
      <div className="peers-actions peers-page-actions">
        <button type="button" className="btn primary" onClick={() => setPanel(panel === 'add' ? null : 'add')}>Add computer</button>
        <button type="button" className="btn" onClick={() => setPanel(panel === 'join' ? null : 'join')}>Join computer</button>
      </div>
      {panel === 'add' && <PeerDialog title="Add a computer"><AddComputer connections={connections} onChange={refreshAll} onClose={() => setPanel(null)} /></PeerDialog>}
      {panel === 'join' && <PeerDialog title="Join computer"><JoinComputer connections={connections} onChange={refreshAll} onClose={() => setPanel(null)} /></PeerDialog>}
      {inProgress.length > 0 && (
        <ul className="peers-list" aria-label="Connections in progress">
          {inProgress.map((connection) => (
            <li key={connection.invitationId} className="peers-link" data-testid="peer-connection">
              <div className="peers-link-header">
                <h4 className="peers-link-name">{connection.peer?.name ?? (connection.role === 'inviter' ? 'Waiting for a computer to join' : 'Joining a computer')}</h4>
                <span className="peers-state" data-state={connection.state === 'failed' ? 'failed' : 'paused'} role="status">{connection.state}</span>
                {CANCELLABLE_CONNECTION_STATES.has(connection.state) && (
                  <button type="button" className="btn peers-btn-remove" disabled={busy !== null} onClick={() => void cancelConnection(connection.invitationId)}>Cancel</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="peers-error" role="alert">{error}</p>}
      {links === null && !error && <p className="peers-loading" role="status">Loading links…</p>}
      {links !== null && links.length === 0 && (
        <SearchTarget searchId="peers.empty" block><p className="peers-empty">{plugins !== null && !hasPeerPlugin
          ? 'No installed plugin uses peers yet. You can add a computer now; a plugin can request to use the connection after it is installed and enabled.'
          : 'No connections yet. Add a computer here, then let a plugin request to use the connection when needed.'}</p></SearchTarget>
      )}
      {links !== null && links.length > 0 && (
        <SearchTarget searchId="peers.link-list" block>
          <ul className="peers-list" aria-label="Peer links">
            {groups.map((group) => {
              const primary = group.links[0]!;
              const many = group.links.length > 1;
              const linked = group.links.some((link) => link.state === 'linked');
              return (
                <li key={group.id} className="peers-link peers-computer" data-testid="peer-computer">
                  <div className="peers-link-header">
                    <h4 className="peers-link-name">{group.name}</h4>
                    {linked && <span className="peers-linked" data-testid="peer-linked">Linked</span>}
                    <LinkStatuses link={primary} />
                    {!many && !flow && (
                      <div className="peers-link-actions">
                        {primary.state === 'linked' && primary.paused && (
                          <button type="button" className="btn peers-btn-secondary" disabled={busy !== null} onClick={() => void resume(primary.hostId)}>Resume</button>
                        )}
                        {primary.state === 'linked' && !primary.paused && (
                          <button type="button" className="btn peers-btn-secondary" disabled={busy !== null} onClick={() => void pause(primary.hostId)}>Pause</button>
                        )}
                        <button type="button" className="btn peers-btn-remove" disabled={busy !== null} onClick={() => setFlow({ kind: 'link', hostId: primary.hostId, step: 'confirm' })}>Remove computer</button>
                      </div>
                    )}
                  </div>
                  {group.links.some((link) => link.uses.length > 0) && <h5 className="peers-used-by">Used by</h5>}
                  {!group.links.some((link) => link.uses.length > 0) && <p className="peers-empty">No plugin uses this computer.</p>}
                  <ul className="peers-list" aria-label="Computer links">
                    {group.links.map((link) => {
                      const dialog = flow && flow.kind === 'link' && flow.hostId === link.hostId ? flow : null;
                      return (
                        <li key={link.hostId} className="peers-link-entry" data-testid="peer-link">
                          <div className={many ? 'peers-link-header' : 'peers-link-header peers-link-header-empty'}>
                            {many && <LinkStatuses link={link} />}
                            {many && !dialog && (
                              <div className="peers-link-actions">
                                {link.state === 'linked' && link.paused && (
                                  <button type="button" className="btn peers-btn-secondary" disabled={busy !== null} onClick={() => void resume(link.hostId)}>Resume</button>
                                )}
                                {link.state === 'linked' && !link.paused && (
                                  <button type="button" className="btn peers-btn-secondary" disabled={busy !== null} onClick={() => void pause(link.hostId)}>Pause</button>
                                )}
                                <button type="button" className="btn peers-btn-remove" disabled={busy !== null} onClick={() => setFlow({ kind: 'link', hostId: link.hostId, step: 'confirm' })}>Remove computer</button>
                              </div>
                            )}
                          </div>
                           {!dialog && <StuckStateActions link={link} showRemove={false} busy={busy !== null} onAction={(action) => void stuckAction(link, action)} />}
                          {link.uses.length > 0 && (
                            <ul className="peers-uses" aria-label="Plugin uses">
                              {link.uses.map((use) => {
                                const key = `use:${link.hostId}:${use.pluginId}:${use.scope}`;
                                const useDialog = flow && flow.kind === 'use' && flow.key === key;
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
                                    {useDialog ? (
                                      <ActiveUseConfirm
                                        active={[{ label: use.label }]}
                                        host={link.peerName}
                                        busy={busy !== null}
                                        onStop={() => void removeUse({ kind: 'use', hostId: link.hostId, pluginId: use.pluginId, scope: use.scope })}
                                        onCancel={() => setFlow(null)}
                                      />
                                    ) : (
                                      <button
                                        type="button"
                                        className="btn"
                                        disabled={busy !== null}
                                        aria-label={`Stop syncing ${use.label}`}
                                        onClick={() => void startStopUse(link.hostId, use.pluginId, use.scope, key)}
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
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
        </SearchTarget>
      )}
      <LeftoverAccess leftovers={leftovers} busy={busy !== null} onForget={(id) => void forgetLeftover(id)} />
      {flow?.kind === 'link' && (() => {
        const link = links?.find((item) => item.hostId === flow.hostId);
        if (!link) return null;
        if (flow.step === 'confirm') return <PeerDialog title={`Remove ${link.peerName}?`}><RemovePluginsConfirm text={`Remove this computer's connection for all plugins?${link.uses.length ? ` Plugins using it: ${[...new Set(link.uses.map((use) => use.label))].join(', ')}.` : ''}`} busy={busy !== null} onConfirm={() => void removeLink(link.hostId)} onCancel={() => setFlow(null)} /></PeerDialog>;
        if (flow.step === 'force') return <PeerDialog title={`Remove ${link.peerName}?`}><RemovePluginsConfirm text={forceRemoveText(link)} busy={busy !== null} onConfirm={() => void removeLink(link.hostId, true)} onCancel={() => setFlow(null)} /></PeerDialog>;
        if (flow.step === 'failed') return <PeerDialog title="Plugin cleanup did not finish"><HookFailureDialog failures={flow.failures} busy={busy !== null} onRetry={() => void removeLink(link.hostId)} onRemoveAnyway={() => void removeLink(link.hostId, true)} onCancel={() => setFlow(null)} /></PeerDialog>;
        return null;
      })()}
    </div>
  );
}
