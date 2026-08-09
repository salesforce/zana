/**
 * Stand-in for the `react` module inside the zana extension bundle.
 *
 * The build aliases bare `import … from 'react'` to this file. Every export
 * delegates to the host's React (captured at activate time, see ./host-react),
 * so the bundle ships NO React of its own yet every hook/createElement call
 * resolves against the host's single React instance — the thing that keeps
 * hooks working across the blob-import boundary.
 *
 * These are thin wrappers (not `export const useState = getHostReact().useState`)
 * on purpose: the binding must be read at CALL time, not at module-eval time,
 * because module eval happens during the blob import — before `activate` has set
 * the host React. Calls happen at render, strictly after activate.
 *
 * Only the surface the zana renderer actually uses is re-exported. If the panel
 * starts using another React API, add it here.
 */
import { getHostReact } from './host-react.js';

export const useState: typeof import('react').useState = (...a: unknown[]) =>
  (getHostReact().useState as (...x: unknown[]) => unknown)(...a) as never;
export const useEffect: typeof import('react').useEffect = (...a: unknown[]) =>
  (getHostReact().useEffect as (...x: unknown[]) => unknown)(...a) as never;
export const useCallback: typeof import('react').useCallback = (...a: unknown[]) =>
  (getHostReact().useCallback as (...x: unknown[]) => unknown)(...a) as never;
export const useMemo: typeof import('react').useMemo = (...a: unknown[]) =>
  (getHostReact().useMemo as (...x: unknown[]) => unknown)(...a) as never;
export const useRef: typeof import('react').useRef = (...a: unknown[]) =>
  (getHostReact().useRef as (...x: unknown[]) => unknown)(...a) as never;
export const createElement: typeof import('react').createElement = (...a: unknown[]) =>
  (getHostReact().createElement as (...x: unknown[]) => unknown)(...a) as never;
/**
 * forwardRef is used by lucide-react's Icon factory — and CRUCIALLY it's called
 * at lucide's MODULE-EVAL time (when this bundle is imported), which is BEFORE
 * the host loader calls `activate()` to set the host React. So this one cannot
 * touch `getHostReact()` eagerly (that throws "host React not set").
 *
 * Instead we defer: capture the render fn now and return a thin function
 * component that, at RENDER time (strictly after activate), builds the real
 * `forwardRef` component against the host React and renders it. The wrapped
 * component is memoised so React sees a stable type across renders. This keeps
 * full ref-forwarding semantics while resolving React lazily.
 */
// forwardRef is used by lucide-react's Icon factory. Note lucide calls this at
// its MODULE-EVAL time (bundle import), which is BEFORE activate runs — but the
// host primes React onto a global immediately before importing the bundle (see
// host-react), so `getHostReact()` already resolves here. Plain delegation,
// full ref-forwarding intact.
export const forwardRef: typeof import('react').forwardRef = (...a: unknown[]) =>
  (getHostReact().forwardRef as (...x: unknown[]) => unknown)(...a) as never;
export const memo: typeof import('react').memo = (...a: unknown[]) =>
  (getHostReact().memo as (...x: unknown[]) => unknown)(...a) as never;

// A default export so `import React from 'react'` (and esbuild's interop) works.
// It's a live proxy onto the host React: reads resolve against the real instance
// at access time, so `React.useState` etc. behave like the named exports above.
const reactDefault: typeof import('react') = new Proxy(
  {},
  {
    get(_t, prop) {
      return (getHostReact() as unknown as Record<string | symbol, unknown>)[prop];
    },
    has(_t, prop) {
      return prop in getHostReact();
    }
  }
) as typeof import('react');

export default reactDefault;
