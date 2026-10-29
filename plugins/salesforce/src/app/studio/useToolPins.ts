import { useCallback, useEffect, useState } from 'react';
import { isViewTarget, type ViewTarget } from './studio-layout.js';

type ToolPins = Partial<Record<ViewTarget, string>>;

/** A tool may inspect one agent while the editor moves to another. Only layout is stored here. */
export function readToolPins(key: string): ToolPins {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([tool, path]) =>
      isViewTarget(tool) && typeof path === 'string' && path.length > 0 && path.length <= 4096));
  } catch { return {}; }
}

export function useToolPins(scope: string) {
  const key = `salesforce:studio:pins:${scope}`;
  const [pins, setPins] = useState<ToolPins>(() => readToolPins(key));
  useEffect(() => { try {
    if (Object.keys(pins).length) localStorage.setItem(key, JSON.stringify(pins)); else localStorage.removeItem(key);
  } catch { /* optional layout storage */ } }, [key, pins]);
  const pin = useCallback((tool: ViewTarget, path: string | null) => setPins(current => {
    if ((current[tool] ?? null) === path) return current;
    const next = { ...current };
    if (path) next[tool] = path; else delete next[tool];
    return next;
  }), []);
  const forget = useCallback((path: string) => setPins(current => Object.fromEntries(Object.entries(current).filter(([, owner]) => owner !== path))), []);
  return { pins, pin, forget };
}
