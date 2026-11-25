import { product } from '../../../lib/product-client.js';
import { onThreadArchived } from '../../../thread-store.js';
import { disposeRetainedHtmlPreviews, htmlPreviewRetention } from './htmlPreviewRetention.js';

/** Installed once by the application, never per conversation or window route. */
export function installHtmlPreviewRetentionLifecycle(): () => void {
  const registry = htmlPreviewRetention(document);
  const unsubscribeArchive = onThreadArchived(threadId => registry.forgetOwner(threadId));
  const unsubscribeTabs = product.threads.onTabs(payload => {
    if (!payload || typeof payload !== 'object') return;
    const row = payload as { threadId?: unknown; revision?: unknown; tabs?: unknown };
    if (typeof row.threadId !== 'string' || typeof row.revision !== 'number' || !Number.isSafeInteger(row.revision)
      || row.revision < 0 || !Array.isArray(row.tabs)) return;
    // Reject incomplete events rather than discarding cached pages incorrectly.
    if (!row.tabs.every(tab => tab && typeof tab === 'object' && typeof tab.id === 'string')) return;
    registry.observeServerTabs(row.threadId, row.revision, new Set(row.tabs.map(tab => tab.id)));
  });
  return () => {
    unsubscribeArchive();
    unsubscribeTabs();
    disposeRetainedHtmlPreviews(document);
  };
}
