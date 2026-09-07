interface DebouncedCallbackSchedulerArgs {
  debounceMs: number;
  maxWaitMs: number;
  onFlush: () => void;
}

interface DebouncedCallbackScheduler {
  dispose: () => void;
  schedule: () => void;
}

export function createDebouncedCallbackScheduler(
  args: DebouncedCallbackSchedulerArgs,
): DebouncedCallbackScheduler {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;

  const clearTimers = () => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (maxWaitTimer !== null) {
      clearTimeout(maxWaitTimer);
      maxWaitTimer = null;
    }
  };

  const flush = () => {
    clearTimers();
    args.onFlush();
  };

  return {
    dispose: clearTimers,
    schedule: () => {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(flush, args.debounceMs);
      if (maxWaitTimer === null) {
        maxWaitTimer = setTimeout(flush, args.maxWaitMs);
      }
    },
  };
}
