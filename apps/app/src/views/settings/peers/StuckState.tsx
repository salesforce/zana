import { useState } from 'react';
import type { PeerLink } from '@zana-ai/zcc-server-contract';
import type { PeerLeftover } from '../../../lib/product-client.js';

export type StuckAction = 'retry' | 'reconnect' | 'remove-anyway' | 'forget-leftover-access';

export const STUCK_ACTION_LABELS: Record<StuckAction, string> = {
  retry: 'Retry',
  reconnect: 'Reconnect',
  'remove-anyway': 'Remove anyway',
  'forget-leftover-access': 'Forget leftover access'
};

/**
 * Plain-language description of a blocked or orphaned link plus the actions that get the owner out of it.
 * Healthy, paused and removed links return null. Pure: the server's own `reason` text is never shown here.
 */
export function stuckStateOf(link: PeerLink, ctx?: { name?: string }): { text: string; actions: StuckAction[] } | null {
  const name = ctx?.name ?? link.peerName;
  switch (link.state) {
    case 'failed':
      return { text: "Pairing didn't finish on this computer.", actions: ['remove-anyway'] };
    case 'unclaimed':
      return { text: 'No plugin owns this connection and nothing uses it.', actions: ['remove-anyway'] };
    case 'pre-consent':
    case 'activating':
      return link.connected ? null : { text: 'Waiting for the other computer…', actions: ['retry', 'remove-anyway'] };
    case 'linked':
      if (link.paused || link.connected) return null;
      return { text: `Can't reach ${name}. Check that both computers are on, running Zana, and on the same network.`, actions: ['reconnect', 'remove-anyway'] };
    default:
      return null;
  }
}

export function forceRemoveText(link: Pick<PeerLink, 'peerName' | 'uses'>): string {
  const names = [...new Set(link.uses.map((use) => use.label))];
  const may = names.length ? `${names.join(', ')} may keep leftover access` : 'Any plugin that used it may keep leftover access';
  return `Remove ${link.peerName} anyway without waiting for plugins to clean up? ${may}.`;
}

export function StuckStateActions({ link, busy, onAction, showRemove = true }: {
  link: PeerLink;
  busy?: boolean;
  showRemove?: boolean;
  onAction: (action: StuckAction) => void;
}) {
  const stuck = stuckStateOf(link);
  if (!stuck) return null;
  return (
    <div className="peers-stuck" data-testid="peer-stuck" data-state={link.state}>
      <p className="peers-stuck-text">{stuck.text}</p>
      <div className="peers-link-actions">
        {stuck.actions.filter((action) => showRemove || action !== 'remove-anyway').map((action) => (
          <button
            key={action}
            type="button"
            className={action === 'remove-anyway' ? 'btn peers-btn-remove' : 'btn peers-btn-secondary'}
            disabled={busy}
            onClick={() => onAction(action)}
          >
            {STUCK_ACTION_LABELS[action]}
          </button>
        ))}
      </div>
    </div>
  );
}

export function leftoverText(leftover: PeerLeftover): string {
  const labels = [...new Set(leftover.plugins.map((plugin) => plugin.label))];
  const who = labels.length ? labels.join(', ') : 'A plugin';
  return `${leftover.name}: ${who} may still hold access from a removal that did not finish cleaning up.`;
}

/** Shown only when the server reports leftovers; each row resolves with one confirmed Forget. */
export function LeftoverAccess({ leftovers, busy, onForget }: {
  leftovers: PeerLeftover[];
  busy?: boolean;
  onForget: (computerId: string) => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  if (leftovers.length === 0) return null;
  return (
    <div className="peers-leftovers" data-testid="peer-leftovers">
      <h4 className="peers-link-name">Leftover access</h4>
      <ul className="peers-list" aria-label="Leftover access">
        {leftovers.map((leftover) => (
          <li key={leftover.computerId} className="peers-link-entry" data-testid="peer-leftover">
            <p className="peers-stuck-text">{leftoverText(leftover)}</p>
            {confirming === leftover.computerId ? (
              <div className="peers-link-actions" role="alertdialog" aria-label={`Forget leftover access for ${leftover.name}`}>
                <span className="peers-confirm-text">Stop tracking this leftover access for {leftover.name}? Plugins will no longer be told to clean it up.</span>
                <button type="button" className="btn danger" disabled={busy} onClick={() => { setConfirming(null); onForget(leftover.computerId); }}>Confirm forget</button>
                <button type="button" className="btn" onClick={() => setConfirming(null)}>Cancel</button>
              </div>
            ) : (
              <div className="peers-link-actions">
                <button type="button" className="btn peers-btn-remove" disabled={busy} onClick={() => setConfirming(leftover.computerId)}>{STUCK_ACTION_LABELS['forget-leftover-access']}</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
