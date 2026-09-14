import { ChevronLeft } from 'lucide-react';
import type { MarketplaceEntry } from '@zana-ai/zcc-domain/product';
import { PluginCatalogGrid } from './PluginCatalogCard.js';
import { authorDisplayName, entriesByAuthor } from './plugin-browse-discovery.js';

export function PluginAuthorPage({
  authorKey,
  entries,
  busy,
  errors,
  onBack,
  onOpen,
  onInstall
}: {
  authorKey: string;
  entries: MarketplaceEntry[];
  busy: Record<string, string>;
  errors: Record<string, string>;
  onBack: () => void;
  onOpen: (entry: MarketplaceEntry) => void;
  onInstall: (entry: MarketplaceEntry) => void;
}) {
  const authored = entriesByAuthor(entries, authorKey);
  const name = authorDisplayName(entries, authorKey);
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <section className="ext-browse-author" data-testid="plugin-author-page">
      <button type="button" className="settings-btn ext-installed-back" onClick={onBack}>
        <ChevronLeft size={14} />
        Back to Browse
      </button>
      <header className="ext-browse-author-header">
        <span className="ext-browse-author-avatar" aria-hidden="true">
          {initial}
        </span>
        <div>
          <h3>{name}</h3>
          <p className="settings-help">
            {authored.length === 1 ? '1 plugin' : `${authored.length} plugins`} in the catalog
          </p>
        </div>
      </header>
      <PluginCatalogGrid
        entries={authored}
        showCategory
        busy={busy}
        errors={errors}
        onOpen={onOpen}
        onInstall={onInstall}
        empty={<p className="settings-help settings-help--muted">No plugins from this author.</p>}
      />
    </section>
  );
}
