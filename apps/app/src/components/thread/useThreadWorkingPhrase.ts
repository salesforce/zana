import { useState } from 'react';
import { nextWorkingPhraseTick, threadWorkingPhrase } from './thread-timeline-model.js';

/** Holds one busy-thread phrase per display; advances when working hides. */
export function useThreadWorkingPhrase(active = true): string {
  const [tick, setTick] = useState(0);
  const [wasActive, setWasActive] = useState(active);
  if (wasActive !== active) {
    setWasActive(active);
    setTick(nextWorkingPhraseTick(tick, wasActive, active));
  }
  return threadWorkingPhrase(tick);
}
