import { connectedDomParkingHost, moveConnectedElement, supportsConnectedMove } from '../../../lib/connected-dom-parking.js';

/** Only inactive HTML frames are cached; conversation trees and native views are not. */
export const MAX_RETAINED_HTML_PREVIEWS = 8;
export interface HtmlPreviewIdentity {
  path: string;
  src: string;
  ownerId?: string | null;
  tabId?: string | null;
}
interface Entry extends HtmlPreviewIdentity {
  baseKey: string;
  frame: HTMLIFrameElement;
  anchor: HTMLElement | null;
  serverRevision?: number;
  serverKnown?: boolean;
}

const registries = new WeakMap<Document, HtmlPreviewRetention>();

function sourceKey(src: string): string {
  const url = new URL(src, 'http://preview.invalid');
  url.searchParams.delete('rev');
  return `${url.pathname}?${url.searchParams}`;
}

/** Window-local, bounded live DOM: no arbitrary page state is read or serialized. */
export class HtmlPreviewRetention {
  private entries = new Set<Entry>();
  private readonly retry = (event: MessageEvent) => {
    if (!event.source || event.data?.type !== 'zcc:html-preview:retry') return;
    for (const entry of this.entries) {
      if (event.source !== entry.frame.contentWindow) continue;
      const frame = this.createFrame(entry);
      entry.frame.replaceWith(frame);
      entry.frame = frame;
      return;
    }
  };

  constructor(private readonly document: Document) {
    document.defaultView?.addEventListener('message', this.retry);
  }

  private createFrame(identity: HtmlPreviewIdentity): HTMLIFrameElement {
    const frame = this.document.createElement('iframe');
    frame.className = 'thread-file-preview-html';
    frame.dataset.testid = 'thread-file-preview-html';
    frame.title = identity.path;
    // Keep the existing opaque-origin sandbox and authorized server endpoint.
    frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals');
    frame.setAttribute('src', identity.src);
    return frame;
  }

  mount(anchor: HTMLElement, identity: HtmlPreviewIdentity): () => void {
    const baseKey = JSON.stringify([identity.ownerId ?? null, identity.tabId ?? null, sourceKey(identity.src)]);
    let entry = [...this.entries].find(row => row.baseKey === baseKey && row.anchor === null);
    if (entry) {
      this.entries.delete(entry);
      if (entry.src !== identity.src) {
        entry.frame.remove();
        entry.frame = this.createFrame(identity);
      }
      Object.assign(entry, identity, { anchor });
    } else {
      entry = { ...identity, baseKey, frame: this.createFrame(identity), anchor };
    }
    const current = entry;
    this.entries.add(current);
    moveConnectedElement(anchor, current.frame);
    return () => {
      if (!this.entries.has(current)) return;
      current.anchor = null;
      if (identity.tabId && supportsConnectedMove(this.document) && current.frame.isConnected) {
        moveConnectedElement(connectedDomParkingHost(this.document), current.frame);
        this.entries.delete(current);
        this.entries.add(current);
        this.prune();
      } else {
        // Retaining a detached iframe would only pretend to preserve its page.
        this.remove(current);
      }
    };
  }

  private remove(entry: Entry): void {
    entry.frame.remove();
    this.entries.delete(entry);
  }

  private prune(): void {
    const inactive = [...this.entries].filter(entry => entry.anchor === null);
    for (const entry of inactive.slice(0, Math.max(0, inactive.length - MAX_RETAINED_HTML_PREVIEWS))) this.remove(entry);
  }

  forgetTab(ownerId: string, tabId: string): void {
    for (const entry of this.entries) {
      if (entry.ownerId === ownerId && entry.tabId === tabId) this.remove(entry);
    }
  }

  forgetOwner(ownerId: string): void {
    for (const entry of this.entries) {
      if (entry.ownerId === ownerId) this.remove(entry);
    }
  }

  /** A server update can close tabs while their conversation is off-route. */
  retainOwnerTabs(ownerId: string, tabIds: ReadonlySet<string>): void {
    for (const entry of this.entries) {
      if (entry.ownerId === ownerId && entry.tabId && !tabIds.has(entry.tabId)) this.remove(entry);
    }
  }

  observeServerTabs(ownerId: string, revision: number, tabIds: ReadonlySet<string>): void {
    for (const entry of this.entries) {
      if (entry.ownerId !== ownerId || !entry.tabId || revision <= (entry.serverRevision ?? -1)) continue;
      const present = tabIds.has(entry.tabId);
      // A stale SSE echo may precede saving a new local tab. Only a tab known
      // to the server can be remotely closed, and mounted owners reconcile
      // through their existing version-aware panel hook.
      if (entry.anchor === null && entry.serverKnown && !present) this.remove(entry);
      else {
        entry.serverRevision = revision;
        entry.serverKnown = present;
      }
    }
  }

  dispose(): void {
    this.document.defaultView?.removeEventListener('message', this.retry);
    for (const entry of this.entries) this.remove(entry);
  }
}

export function htmlPreviewRetention(document: Document): HtmlPreviewRetention {
  let registry = registries.get(document);
  if (!registry) {
    registry = new HtmlPreviewRetention(document);
    registries.set(document, registry);
  }
  return registry;
}

export function forgetRetainedHtmlPreviewTab(ownerId: string, tabId: string): void {
  if (typeof document !== 'undefined') registries.get(document)?.forgetTab(ownerId, tabId);
}

export function observeRetainedHtmlPreviewTabs(ownerId: string, revision: number, tabIds: ReadonlySet<string>): void {
  if (typeof document !== 'undefined') registries.get(document)?.observeServerTabs(ownerId, revision, tabIds);
}

export function retainHtmlPreviewOwnerTabs(ownerId: string, tabIds: ReadonlySet<string>): void {
  if (typeof document !== 'undefined') registries.get(document)?.retainOwnerTabs(ownerId, tabIds);
}

export function disposeRetainedHtmlPreviews(document: Document): void {
  registries.get(document)?.dispose();
  registries.delete(document);
}
