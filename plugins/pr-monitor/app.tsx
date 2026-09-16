import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { callPluginRpc, definePluginApp, useRealtime } from '@zana-ai/zcc-plugin-sdk/app';
import PrMonitorPanel from './src/app/PrMonitorPanel.js';
import { createPluginPanelHost, setBadgeRefresh } from './src/app/adapter.js';
import { PRS_CHANGED_CHANNEL } from './lib/realtime.js';
import type { MonitoredPr, PrStatusDelta } from './lib/types.js';
import { MONITORED_COUNT_CACHE_KEY, MONITORED_PRS_CACHE_KEY } from './lib/types.js';
import { statusLabel } from './src/app/formatHelpers.js';
import styles from './src/app/styles.css';
import kanbanCss from '@zana-ai/zcc-ui/kanban.css';

const PLUGIN_ID = 'pr-monitor';
const STYLE_TAG_ID = 'prm-plugin-styles';

type PluginRuntime = { toast?: (message: string, kind?: 'info' | 'error') => void };

function pluginRuntime(): PluginRuntime | undefined {
  return (globalThis as { __ZCC_PLUGIN_RUNTIME__?: PluginRuntime }).__ZCC_PLUGIN_RUNTIME__;
}

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
  useRealtime(PRS_CHANGED_CHANNEL, (payload) => {
    const prs = (payload as { prs?: unknown })?.prs;
    if (!Array.isArray(prs)) return;
    host.cache.set(MONITORED_PRS_CACHE_KEY, prs as MonitoredPr[]);
    host.cache.set(MONITORED_COUNT_CACHE_KEY, prs.length);
    host.cache.refreshBadge?.();
  });
  return (
    <div style={panelRootStyle}>
      <PrMonitorPanel host={host} />
    </div>
  );
}

function NavBadge() {
  const [count, setCount] = useState<number | null>(null);
  const aliveRef = useRef(true);
  const refreshIdRef = useRef(0);
  const refreshBadge = useCallback(async () => {
    const refreshId = ++refreshIdRef.current;
    try {
      const result = (await callPluginRpc(PLUGIN_ID, 'badge')) as { count?: number | null };
      if (!aliveRef.current || refreshId !== refreshIdRef.current) return;
      const next = typeof result?.count === 'number' && result.count > 0 ? result.count : null;
      setCount(next);
    } catch (err) {
      if (!aliveRef.current || refreshId !== refreshIdRef.current) return;
      // Keep zero/error hidden, but expose RPC failures for support diagnosis.
      console.warn('[pr-monitor] badge refresh failed', err);
      setCount(null);
    }
  }, []);
  useEffect(() => {
    aliveRef.current = true;
    void refreshBadge();
    setBadgeRefresh(() => {
      if (aliveRef.current) void refreshBadge();
    });
    return () => {
      aliveRef.current = false;
      refreshIdRef.current++;
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
      const runtime = pluginRuntime();
      for (const delta of deltas) {
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
