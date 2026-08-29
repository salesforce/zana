import { useEffect, useState } from 'react';
import {
  THREAD_WORKING_PHRASE_INTERVAL_MS,
  THREAD_WORKING_PHRASES,
  threadWorkingPhrase
} from './thread-timeline-model.js';

/** Cycles the busy-thread phrases while `active`; resets to the first phrase when idle. */
export function useThreadWorkingPhrase(active = true): string {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) {
      setTick(0);
      return;
    }
    const id = window.setInterval(
      () => setTick((n) => n + 1),
      THREAD_WORKING_PHRASE_INTERVAL_MS
    );
    return () => window.clearInterval(id);
  }, [active]);
  return active ? threadWorkingPhrase(tick) : THREAD_WORKING_PHRASES[0];
}
