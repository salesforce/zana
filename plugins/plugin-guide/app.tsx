import { useCallback, useEffect, useState } from 'react';
import { definePluginApp, useZccNavigate } from '@zana-ai/zcc-plugin-sdk/app';
import { ProductMap } from './src/product-map.js';

function firstPartyPluginId(displayName: string): string | null {
  const map: Record<string, string> = {
    Tasks: 'tasks',
    Automations: 'automations',
    'PR Monitor': 'pr-monitor',
    Docs: 'docs',
    Salesforce: 'salesforce',
    Connect: 'connect',
    Workflows: 'workflows',
    'Side chat': 'side-chat',
    'Ask user question': 'ask-user-question',
    Secrets: 'secrets',
    'Custom instructions': 'custom-instructions',
    'Keep-awake': 'keep-awake',
    'Claude Code': 'provider-claude-code',
    Codex: 'provider-codex',
    Pi: 'provider-pi'
  };
  return map[displayName] ?? null;
}

function PluginGuidePage({ subPath }: { subPath: string }) {
  const navigate = useZccNavigate();
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/v1/plugin-apps')
      .then((response) => (response.ok ? response.json() : { apps: [] }))
      .then((body: { apps?: Array<{ id?: string }> }) => {
        if (cancelled) return;
        setIds(new Set((body.apps ?? []).map((row) => row.id).filter((id): id is string => Boolean(id))));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  const pluginPageHref = useCallback(
    (displayName: string) => {
      const id = firstPartyPluginId(displayName);
      if (!id || !ids.has(id)) return null;
      return `/extensions/plugins/${encodeURIComponent(id)}`;
    },
    [ids]
  );
  return (
    <div className="plugin-guide-scroll" data-guide-stage-viewport>
      <ProductMap
        initialSlideId={subPath.split('/')[0] || undefined}
        onSlideChange={(slideId) => {
          navigate.toPluginPanel('plugin-guide', { subPath: slideId, replace: true });
        }}
        pluginPageHref={pluginPageHref}
      />
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: 'plugin-guide',
    title: 'Plugin Guide',
    icon: 'Puzzle',
    path: 'plugin-guide',
    placement: 'extensions',
    component: PluginGuidePage
  });
});
