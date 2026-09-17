import { useCallback, useEffect, useState, type SetStateAction } from "react";
const KEY = "salesforce.query-drafts.v1";
type Draft = { key: string; query: string };
function read(): Draft[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(data)
      ? data
          .filter(
            (row) =>
              typeof row?.key === "string" && typeof row?.query === "string",
          )
          .slice(0, 30)
      : [];
  } catch {
    return [];
  }
}
export function readQueryDraft(key: string, fallback: string): string {
  return read().find((row) => row.key === key)?.query ?? fallback;
}
export function writeQueryDraft(key: string, query: string): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify(
        [
          { key, query: query.slice(0, 20_000) },
          ...read().filter((row) => row.key !== key),
        ].slice(0, 30),
      ),
    );
  } catch {
    /* An unavailable local store must not interrupt editing. */
  }
}

/** Drafts follow their project/tool, while org switches keep unsent work intact. */
export function useSalesforceDraft(
  key: string,
  fallback = "",
): [string, (value: SetStateAction<string>) => void] {
  const [state, setState] = useState(() => ({
    key,
    value: readQueryDraft(key, fallback),
  }));
  const value = state.key === key ? state.value : readQueryDraft(key, fallback);
  useEffect(() => {
    writeQueryDraft(key, value);
  }, [key, value]);
  const update = useCallback(
    (next: SetStateAction<string>) =>
      setState((current) => {
        const previous =
          current.key === key ? current.value : readQueryDraft(key, fallback);
        return {
          key,
          value: typeof next === "function" ? next(previous) : next,
        };
      }),
    [key, fallback],
  );
  return [value, update];
}
