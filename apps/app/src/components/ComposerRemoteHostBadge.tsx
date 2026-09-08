import type { ComposerRemoteHostBadge as ComposerRemoteHostBadgeModel } from './composer-host-status.js';

export function ComposerRemoteHostBadge({ status }: ComposerRemoteHostBadgeModel) {
  return (
    <span className="composer-remote-host-badge" data-testid="composer-remote-host-badge">
      <span className={`composer-remote-host-status is-${status}`}>
        <span className="composer-remote-host-status-dot" aria-hidden="true" />
        {status === 'online' ? 'Online' : 'Offline'}
      </span>
    </span>
  );
}
