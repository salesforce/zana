import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { callPluginRpc, definePluginApp } from '@zana-ai/zcc-plugin-sdk/app';
import PrMonitorPanel from './src/app/PrMonitorPanel.js';
import { createPluginPanelHost, setBadgeRefresh } from './src/app/adapter.js';
import styles from './src/app/styles.css';

const PLUGIN_ID = 'pr-monitor';
const STYLE_TAG_ID = 'prm-plugin-styles';

export function injectStyles(): void {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById(STYLE_TAG_ID);
  if (existing instanceof HTMLStyleElement) {
    existing.textContent = styles;
    return;
  }
  const tag = document.createElement('style');
  tag.id = STYLE_TAG_ID;
  tag.textContent = styles;
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
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const result = (await callPluginRpc(PLUGIN_ID, 'badge')) as { count?: number | null };
        if (!alive) return;
        const next = typeof result?.count === 'number' && result.count > 0 ? result.count : null;
        setCount(next);
      } catch {
        if (alive) setCount(null);
      }
    };
    void tick();
    setBadgeRefresh(() => {
      void tick();
    });
    const id = window.setInterval(() => {
      void tick();
    }, 30_000);
    return () => {
      alive = false;
      window.clearInterval(id);
      setBadgeRefresh(undefined);
    };
  }, []);
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
