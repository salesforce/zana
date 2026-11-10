import { useCallback, useEffect, useRef, useState } from 'react';

/** Fire-and-forget IPC still needs a rejection owner, including synchronous failures. */
export function companionAction(action: string, command: () => unknown, onFailure?: () => void): void {
  const failed = (err: unknown) => {
    console.error(`[companion] ${action}:`, err);
    onFailure?.();
  };
  try {
    void Promise.resolve(command()).catch(failed);
  } catch (err) {
    failed(err);
  }
}

export type CompanionAction = (action: string, command: () => unknown, onFailure?: () => void) => void;

export function useCompanionAction() {
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const run: CompanionAction = useCallback((action, command, onFailure) => {
    setError(null);
    companionAction(action, command, () => {
      onFailure?.();
      if (alive.current) setError(`Could not ${action}. Try again.`);
    });
  }, []);
  return { run, error };
}
