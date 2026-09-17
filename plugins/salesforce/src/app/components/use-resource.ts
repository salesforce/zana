import { useCallback, useEffect, useRef, useState } from "react";
import { requireResult } from "./client.js";

export function useResource<T>(
  call: (method: string, args?: Record<string, unknown>) => Promise<unknown>,
  method: string | null,
  args: Record<string, unknown> = {},
) {
  const key = JSON.stringify(args);
  const generation = useRef(0);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    if (!method) {
      setData(null);
      setError(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = requireResult<T>(await call(method, JSON.parse(key)));
      if (current === generation.current) setData(result);
    } catch (failure) {
      if (current === generation.current) {
        setError(failure instanceof Error ? failure.message : String(failure));
        setData(null);
      }
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }, [call, method, key]);
  useEffect(() => {
    setData(null);
    void refresh();
    return () => {
      generation.current++;
    };
  }, [refresh]);
  return { data, error, busy, refresh };
}
