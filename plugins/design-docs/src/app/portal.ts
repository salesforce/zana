/**
 * Minimal React portal for the plugin bundle.
 *
 * The host shares its React with the bundle but not ReactDOM, so a bare
 * `createPortal` import would not resolve. A portal element is a plain object
 * the host's reconciler recognises by the globally registered
 * `Symbol.for('react.portal')`, so we can build one without ReactDOM.
 *
 * Overlays (dialogs, context menus) portal to `document.body`: the panel mounts
 * inside host chrome whose ancestors can become the containing block for
 * `position: fixed`, which clips a full-window backdrop to the panel and
 * off-centres the dialog.
 */
import type { ReactNode, ReactPortal } from 'react';

const REACT_PORTAL_TYPE = Symbol.for('react.portal');

/** Build a React portal element rendering `children` into `container`. */
export function portal(children: ReactNode, container: Element): ReactPortal {
  return {
    $$typeof: REACT_PORTAL_TYPE,
    key: null,
    children,
    containerInfo: container,
    implementation: null
  } as unknown as ReactPortal;
}

/** Portal `node` to `document.body`, or render it in place when there is no DOM. */
export function toBody(node: ReactNode): ReactNode {
  return typeof document === 'undefined' ? node : portal(node, document.body);
}
