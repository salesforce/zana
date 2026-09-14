import { useEffect, useState } from 'react';
import { callPluginRpc } from '@zana-ai/zcc-plugin-sdk/app';

const PLUGIN_ID = 'tasks';

export function TasksNavBadge() {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const result = (await callPluginRpc(PLUGIN_ID, 'badge')) as { count?: number | null };
        if (!alive) return;
        setCount(typeof result?.count === 'number' && result.count > 0 ? result.count : null);
      } catch {
        if (alive) setCount(null);
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 15_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);
  if (count == null) return null;
  return <span className="nav-badge">{count}</span>;
}
