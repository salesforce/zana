/**
 * Minimal React portal for the disk-extension bundle.
 *
 * Why hand-rolled: the host injects its React via `activate({ React })` but does
 * NOT expose ReactDOM, and the bundle is blob-imported with no import map, so a
 * bare `import { createPortal } from 'react-dom'` would never resolve. A portal
 * element is just a plain object the host's reconciler recognizes by its
 * `$$typeof` — the GLOBALLY-registered `Symbol.for('react.portal')`, which is
 * the identical symbol in the bundle and in the host's React/ReactDOM. So we can
 * build one without ReactDOM. This is the exact shape react-dom's own
 * `createPortal` returns (children, containerInfo, implementation).
 *
 * What it's for: we portal the project-assignment menu to `document.body` so it
 * is NOT clipped by a transformed or overflow-hidden ancestor. A transformed
 * ancestor becomes the containing block for `position: fixed` descendants — so
 * on mousedown a nested fixed menu re-anchored to the tile and was clipped,
 * sliding the clicked item out from under the cursor before the click could
 * fire. A body portal has no such ancestor, so the fixed coordinates resolve
 * against the viewport as intended and the click lands.
 */
import type { ReactNode, ReactPortal } from 'react';

/** The reconciler's portal tag — a process-global registered symbol. */
const REACT_PORTAL_TYPE = Symbol.for('react.portal');

/** Build a React portal element rendering `children` into `container`. */
export function portal(children: ReactNode, container: Element): ReactPortal {
  return {
    $$typeof: REACT_PORTAL_TYPE,
    key: null,
    children,
    containerInfo: container,
    implementation: null,
  } as unknown as ReactPortal;
}
