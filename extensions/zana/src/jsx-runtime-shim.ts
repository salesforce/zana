/**
 * Stand-in for `react/jsx-runtime` inside the zana extension bundle.
 *
 * With `jsx: 'automatic'`, TSX compiles `<div/>` to `jsx('div', …)` and `<>…</>`
 * to `jsx(Fragment, …)`, importing `jsx`/`jsxs`/`Fragment` from
 * `react/jsx-runtime`. The build aliases that bare import here so nothing
 * unresolved survives into the blob-imported bundle.
 *
 * `jsx`/`jsxs` delegate to the host React's `jsx-runtime` (React 18 ships it at
 * `react/jsx-runtime`, but it's equivalent to `createElement`, so we route
 * through the host React we already hold). We call `createElement` rather than
 * the host's internal `jsx` to avoid depending on a non-public export: the
 * difference (key handling) is immaterial for our statically-authored panel.
 *
 * `Fragment` is exported as a sentinel; `jsx`/`jsxs` swap it for the host's real
 * `React.Fragment` at call time (we can't export the real one at module-eval
 * time — the host React isn't set until activate runs).
 */
import { getHostReact } from './host-react.js';

/** Unique marker the compiler passes for `<>…</>`; swapped for the real one. */
export const Fragment: unique symbol = Symbol.for('zana.jsx.Fragment');

type Props = Record<string, unknown> & { children?: unknown };

function build(type: unknown, props: Props | null, key?: unknown): unknown {
  const React = getHostReact();
  const realType = type === Fragment ? React.Fragment : type;
  const { children, ...rest } = props ?? {};
  const restWithKey = key === undefined ? rest : { ...rest, key };
  // createElement(type, props, ...children) — spread array children so each is a
  // positional child, matching what jsx/jsxs would produce.
  if (Array.isArray(children)) {
    return React.createElement(realType as never, restWithKey as never, ...children);
  }
  if (children === undefined) {
    return React.createElement(realType as never, restWithKey as never);
  }
  return React.createElement(realType as never, restWithKey as never, children as never);
}

export function jsx(type: unknown, props: Props | null, key?: unknown): unknown {
  return build(type, props, key);
}

export function jsxs(type: unknown, props: Props | null, key?: unknown): unknown {
  return build(type, props, key);
}
