import type { ThreadListItem } from '../../thread-store.js';
import { PluginOwnedThreadIcon } from '../../plugins/PluginThreadHeaderActions.js';
import { ProviderIcon } from './pickers/ProviderIcon.js';

export function ThreadIdentityIcon({ thread, className }: {
  thread: Pick<ThreadListItem, 'id' | 'originPluginId' | 'providerId'>;
  className: string;
}) {
  const providerIcon = <ProviderIcon providerId={thread.providerId} size={14} />;
  return (
    <span className={`thread-identity-icon ${className}`} aria-hidden="true">
      {thread.originPluginId
        ? <PluginOwnedThreadIcon owner={thread.originPluginId} threadId={thread.id} size={20} fallback={providerIcon} />
        : providerIcon}
    </span>
  );
}
