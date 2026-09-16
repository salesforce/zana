import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { callPluginRpc, definePluginApp, useRealtime } from '@zana-ai/zcc-plugin-sdk/app';
import PrMonitorPanel from './src/app/PrMonitorPanel.js';
import { createPluginPanelHost, setBadgeRefresh } from './src/app/adapter.js';
import { PRS_CHANGED_CHANNEL } from './lib/realtime.js';
import type { PrStatusDelta } from './lib/types.js';
import { statusLabel } from './src/app/formatHelpers.js';
import styles from './src/app/styles.css';
import kanbanCss from '@zana-ai/zcc-ui/kanban.css';

const PLUGIN_ID = 'pr-monitor';
const STYLE_TAG_ID = 'prm-plugin-styles';

export function injectStyles(): void {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById(STYLE_TAG_ID);
  if (existing instanceof HTMLStyleElement) {
    existing.textContent = `${kanbanCss}\n${styles}`;
    return;
  }
  const tag = document.createElement('style');
  tag.id = STYLE_TAG_ID;
  tag.textContent = `${kanbanCss}\n${styles}`;
  document.head.appendChild(tag);
}

injectStyles();

const panelRootStyle: CSSProperties = { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' };

function Panel() {
  const host = useMemo(() => createPluginPanelHost(PLUGIN_ID), []);
  return (
    <div style={panelRootStyle}>
      <PrMonitorPanel host={host} />
    </div>
  );
}

function NavBadge() {
  const [count, setCount] = useState<number | null>(null);
  const refreshBadge = useCallback(async () => {
    try {
      const result = (await callPluginRpc(PLUGIN_ID, 'badge')) as { count?: number | null };
      const next = typeof result?.count === 'number' && result.count > 0 ? result.count : null;
      setCount(next);
    } catch (err) {
      // Keep zero/error hidden, but expose RPC failures for support diagnosis.
      console.warn('[pr-monitor] badge refresh failed', err);
      setCount(null);
    }
  }, []);
  useEffect(() => {
    let alive = true;
    void refreshBadge();
    setBadgeRefresh(() => {
      if (alive) void refreshBadge();
    });
    return () => {
      alive = false;
      setBadgeRefresh(undefined);
    };
  }, [refreshBadge]);
  useRealtime(PRS_CHANGED_CHANNEL, (payload) => {
    void (async () => {
      const deltas = Array.isArray((payload as { inAppDeltas?: unknown })?.inAppDeltas)
        ? ((payload as { inAppDeltas: PrStatusDelta[] }).inAppDeltas)
        : [];
      void refreshBadge();
      if (deltas.length === 0) return;
      for (const delta of deltas) {
        const runtime = (globalThis as { __ZCC_PLUGIN_RUNTIME__?: { toast?: (message: string, kind?: 'info' | 'error') => void } }).__ZCC_PLUGIN_RUNTIME__;
        runtime?.toast?.(`${delta.pr.repo}#${delta.pr.number}: ${statusLabel(delta.oldStatus)} -> ${statusLabel(delta.newStatus)}`, 'info');
      }
    })().catch((err) => console.warn('[pr-monitor] notification delivery failed', err));
  });
  if (count == null) return null;
  return <span className="nav-badge">{count}</span>;
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: 'main',
    title: 'PR Monitor',
    icon: 'GitPullRequest',
    component: Panel,
    experimental_sidebarAccessory: NavBadge
  });
  app.slots.commandPaletteAction({
    id: 'open',
    title: 'Open PR Monitor',
    run: (ctx) => {
      ctx.toPluginPanel('main');
    }
  });
});
