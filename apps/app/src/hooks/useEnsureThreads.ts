import { useEffect } from 'react';
import { useThreads } from '../thread-store.js';

/** Load the global visible-thread roster once per mount; live upserts follow. */
export function useEnsureThreads(): void {
  const load = useThreads((s) => s.load);
  useEffect(() => {
    void load();
  }, [load]);
}
