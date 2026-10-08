import { useEffect, useState } from 'react';
import { formatWorkingElapsed } from './thread-timeline-model.js';

const TICK_MS = 1000;

/** Elapsed label for one visible busy span; restarts each time `active` turns on. */
export function useWorkingElapsed(active: boolean): string | null {
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    setElapsedMs(0);
    if (!active) return undefined;
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAt), TICK_MS);
    return () => clearInterval(timer);
  }, [active]);
  return active ? formatWorkingElapsed(elapsedMs) : null;
}
