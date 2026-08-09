/**
 * The host's React instance, resolved for the shimmed `react` / `react/jsx-runtime`
 * modules this bundle ships instead of a real React.
 *
 * THE central mechanism that makes the zana panel work as a blob-imported disk
 * extension. A runtime extension bundle is read off disk as a string, wrapped in
 * a Blob, and `import()`ed from a `blob:` URL (see src/renderer/modules/loader.ts).
 * A blob import has NO import map, so any bare `import 'react'` /
 * `import 'react/jsx-runtime'` left in the bundle would fail to resolve at load.
 * And bundling our OWN copy of React would put TWO Reacts in one tree → "Invalid
 * hook call".
 *
 * So: the build aliases `react` and `react/jsx-runtime` to in-bundle shims
 * (./react-shim, ./jsx-runtime-shim) that read the host React from here.
 *
 * TWO supply paths, because React is needed at two different times:
 *   1. `activate({ React })` calls {@link setHostReact} — covers hooks/JSX/
 *      createElement, which only run at RENDER (strictly after activate).
 *   2. A host-set GLOBAL (`globalThis.__ZCC_HOST_REACT__`), read lazily by
 *      {@link getHostReact}. This is REQUIRED because a bundled dep can call a
 *      React API at MODULE-EVAL time (lucide-react's Icon factory calls
 *      `forwardRef(...)` at import), which is BEFORE activate runs. The host
 *      loader assigns the global immediately before blob-importing any bundle,
 *      so React is already available during eval. (Real finding of the disk
 *      extension dogfood — a render-time-only injection point is insufficient
 *      for libs that touch React at import.)
 *
 * `getHostReact()` throws only if BOTH are absent — a genuine loader bug.
 */
import type * as ReactNS from 'react';

let hostReact: typeof ReactNS | null = null;

/** The global the host loader assigns before importing an extension bundle. */
const GLOBAL_KEY = '__ZCC_HOST_REACT__';

export function setHostReact(react: typeof ReactNS): void {
  hostReact = react;
}

export function getHostReact(): typeof ReactNS {
  if (hostReact) return hostReact;
  const fromGlobal = (globalThis as Record<string, unknown>)[GLOBAL_KEY];
  if (fromGlobal) {
    hostReact = fromGlobal as typeof ReactNS;
    return hostReact;
  }
  throw new Error(
    'zana extension: host React unavailable — the host must set globalThis.' +
      GLOBAL_KEY +
      ' before import, or call activate({ React }).'
  );
}
