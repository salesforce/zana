import { useEffect, useState } from 'react';

/** Re-render every `intervalMs` so relative-time labels ("5m ago") stay current
 * without depending on unrelated list refreshes. Returns the tick's timestamp. */
export function useNowTick(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
