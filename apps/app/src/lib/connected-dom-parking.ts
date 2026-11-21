/**
 * Chromium's atomic move keeps iframe browsing contexts alive. Ordinary DOM
 * insertion detaches a frame and reloads it, even when the React tree survives.
 */
type AtomicMoveElement = Element & { moveBefore?: (node: Node, before: Node | null) => void };
const parkingHosts = new WeakMap<Document, HTMLDivElement>();

export function supportsConnectedMove(document: Document): boolean {
  return typeof (document.documentElement as AtomicMoveElement).moveBefore === 'function';
}

export function moveConnectedElement(parent: Element, node: Element): void {
  const target = parent as AtomicMoveElement;
  if (parent.isConnected && node.isConnected && typeof target.moveBefore === 'function') {
    target.moveBefore(node, null);
  } else {
    // Older web clients still render correctly, but cannot retain iframe state.
    parent.appendChild(node);
  }
}

export function connectedDomParkingHost(document: Document): HTMLDivElement {
  const existing = parkingHosts.get(document);
  if (existing?.isConnected) return existing;
  const host = document.createElement('div');
  host.hidden = true;
  host.inert = true;
  host.setAttribute('aria-hidden', 'true');
  host.dataset.connectedDomParking = '';
  document.body.appendChild(host);
  parkingHosts.set(document, host);
  return host;
}
