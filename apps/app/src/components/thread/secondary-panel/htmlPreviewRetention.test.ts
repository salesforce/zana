/** @vitest-environment happy-dom */
// @vitest-environment-options {"settings":{"disableIframePageLoading":true}}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HtmlPreviewRetention, MAX_RETAINED_HTML_PREVIEWS, disposeRetainedHtmlPreviews, forgetRetainedHtmlPreviewTab,
  htmlPreviewRetention, observeRetainedHtmlPreviewTabs, retainHtmlPreviewOwnerTabs } from './htmlPreviewRetention.js';
import { connectedDomParkingHost, moveConnectedElement, supportsConnectedMove } from '../../../lib/connected-dom-parking.js';

let registry: HtmlPreviewRetention;
let atomicMove: ReturnType<typeof vi.fn>;
const identity = (id = 'a', extra = {}) => ({ path: `${id}.html`, src: `/api/v1/file-preview/html?path=${id}.html&threadId=t1`,
  ownerId: 't1', tabId: id, ...extra });
const anchor = () => {
  const node = document.createElement('div');
  document.body.appendChild(node);
  return node;
};
const frames = () => [...document.querySelectorAll<HTMLIFrameElement>('iframe')];
const mount = (id = 'a', extra = {}) => {
  const parent = anchor();
  const release = registry.mount(parent, identity(id, extra));
  return { parent, frame: parent.querySelector('iframe')!, release };
};

beforeEach(() => {
  atomicMove = vi.fn(function (this: Element, node: Node) { this.appendChild(node); });
  Object.defineProperty(Element.prototype, 'moveBefore', { configurable: true, value: atomicMove });
  registry = new HtmlPreviewRetention(document);
});
afterEach(() => {
  registry.dispose();
  disposeRetainedHtmlPreviews(document);
  document.body.replaceChildren();
  Reflect.deleteProperty(Element.prototype, 'moveBefore');
  vi.restoreAllMocks();
});

describe('live HTML preview retention', () => {
  it('parks a connected opaque-origin frame and reclaims that same node after navigation', () => {
    const first = mount();
    first.frame.dataset.pageState = 'retained';
    expect(first.frame.getAttribute('sandbox')).toBe('allow-scripts allow-forms allow-modals');
    expect(first.frame.hasAttribute('srcdoc')).toBe(false);
    first.release();
    first.parent.remove();
    const parking = connectedDomParkingHost(document);
    expect(first.frame.parentElement).toBe(parking);
    expect(parking.hidden).toBe(true);
    expect(parking.inert).toBe(true);
    expect(first.frame.isConnected).toBe(true);
    const second = mount();
    expect(second.frame).toBe(first.frame);
    expect(second.frame.dataset.pageState).toBe('retained');
    expect(atomicMove).toHaveBeenCalledTimes(2);
    second.release();
  });

  it('isolates simultaneous hosts and thread/project/storage scopes', () => {
    const first = mount();
    const simultaneous = mount();
    expect(first.frame).not.toBe(simultaneous.frame);
    first.release();
    const otherOwner = mount('a', { ownerId: 't2' });
    const otherProject = mount('a', { src: `${identity().src}&projectId=p2` });
    const storage = mount('a', { src: `${identity().src}&source=thread-storage` });
    const otherTab = mount('a', { tabId: 'different-tab' });
    expect(new Set([first.frame, simultaneous.frame, otherOwner.frame, otherProject.frame, storage.frame, otherTab.frame]).size).toBe(6);
    expect(mount().frame).toBe(first.frame);
  });

  it('refreshes only an explicit URL revision and retains the existing revision otherwise', () => {
    const first = mount();
    first.release();
    const updated = mount('a', { src: `${identity().src}&rev=2` });
    expect(updated.frame).not.toBe(first.frame);
    expect(first.frame.isConnected).toBe(false);
    expect(updated.frame.getAttribute('src')).toContain('rev=2');
    updated.release();
    expect(mount('a', { src: `${identity().src}&rev=2` }).frame).toBe(updated.frame);
  });

  it('keeps at most eight inactive frames and never evicts mounted previews', () => {
    const active = mount('visible');
    const old = mount('old');
    old.release();
    for (let index = 0; index < MAX_RETAINED_HTML_PREVIEWS; index++) mount(String(index)).release();
    expect(frames()).toHaveLength(MAX_RETAINED_HTML_PREVIEWS + 1);
    expect(old.frame.isConnected).toBe(false);
    expect(active.frame.isConnected).toBe(true);
    const recent = mount('0');
    const recentFrame = recent.frame;
    recent.release();
    mount('new').release();
    expect(recentFrame.isConnected).toBe(true);
    expect(frames()).toHaveLength(MAX_RETAINED_HTML_PREVIEWS + 1);
  });

  it('releases explicit close/owner cleanup and cannot resurrect a removed frame', () => {
    const first = mount();
    const other = mount('b');
    registry.forgetTab('other-owner', 'a');
    expect(first.frame.isConnected).toBe(true);
    registry.forgetTab('t1', 'a');
    first.release();
    expect(first.frame.isConnected).toBe(false);
    expect(mount().frame).not.toBe(first.frame);
    registry.forgetOwner('t1');
    other.release();
    expect(frames()).toHaveLength(0);
  });

  it('prunes locally closed tabs while leaving unrelated owners and unkeyed views alone', () => {
    const first = mount();
    const second = mount('b');
    const other = mount('c', { ownerId: 't2' });
    const unkeyed = mount('d', { tabId: null });
    registry.retainOwnerTabs('t1', new Set(['b']));
    expect(first.frame.isConnected).toBe(false);
    expect(second.frame.isConnected).toBe(true);
    expect(other.frame.isConnected).toBe(true);
    expect(unkeyed.frame.isConnected).toBe(true);
  });

  it('honors only newer remote removal of known inactive tabs, ignoring stale echoes and local unsaved additions', () => {
    const retained = mount();
    const newLocal = mount('local');
    const mounted = mount('mounted');
    const other = mount('other', { ownerId: 't2' });
    const unkeyed = mount('unkeyed', { tabId: null });
    registry.observeServerTabs('t1', 2, new Set(['a', 'mounted']));
    retained.release();
    newLocal.release();
    registry.observeServerTabs('t1', 1, new Set());
    expect(retained.frame.isConnected).toBe(true);
    registry.observeServerTabs('t1', 3, new Set());
    expect(retained.frame.isConnected).toBe(false);
    expect(newLocal.frame.isConnected).toBe(true);
    expect(mounted.frame.isConnected).toBe(true);
    expect(other.frame.isConnected).toBe(true);
    expect(unkeyed.frame.isConnected).toBe(true);
  });

  it('accepts retries only from the current frame window and always uses its authorized URL', () => {
    const first = mount();
    const second = mount('b');
    const oldWindow = {} as Window;
    vi.spyOn(first.frame, 'contentWindow', 'get').mockReturnValue(oldWindow);
    const send = (source: Window | null, data: unknown) => window.dispatchEvent(new MessageEvent('message', { source, data }));
    send(window, { type: 'zcc:html-preview:retry' });
    send(null, { type: 'zcc:html-preview:retry' });
    send(oldWindow, null);
    send(oldWindow, { type: 'unknown' });
    expect(first.parent.firstElementChild).toBe(first.frame);
    send(oldWindow, { type: 'zcc:html-preview:retry', url: 'https://untrusted.invalid' });
    const replaced = first.parent.firstElementChild as HTMLIFrameElement;
    expect(replaced).not.toBe(first.frame);
    expect(replaced.getAttribute('src')).toBe(identity().src);
    expect(second.parent.firstElementChild).toBe(second.frame);
    send(oldWindow, { type: 'zcc:html-preview:retry' });
    expect(first.parent.firstElementChild).toBe(replaced);
  });

  it('renders correctly without atomic move but does not pretend to retain detached frame state', () => {
    Reflect.deleteProperty(Element.prototype, 'moveBefore');
    expect(supportsConnectedMove(document)).toBe(false);
    const first = mount();
    first.release();
    expect(first.frame.isConnected).toBe(false);
    expect(mount().frame).not.toBe(first.frame);
  });

  it('does not cache unkeyed previews or a frame already detached by an external host', () => {
    const unkeyed = mount('a', { tabId: null });
    unkeyed.release();
    expect(unkeyed.frame.isConnected).toBe(false);
    const detached = mount('b');
    detached.parent.remove();
    detached.release();
    expect(frames()).toHaveLength(0);
  });

  it('disposes listeners and all live/parked frames at the window boundary', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    mount().release();
    mount('b');
    registry.dispose();
    expect(remove).toHaveBeenCalledWith('message', expect.any(Function));
    expect(frames()).toHaveLength(0);
  });

  it('provides one lazy window registry and safe no-op lifecycle operations before creation', () => {
    forgetRetainedHtmlPreviewTab('t1', 'a');
    observeRetainedHtmlPreviewTabs('t1', 0, new Set());
    retainHtmlPreviewOwnerTabs('t1', new Set());
    const shared = htmlPreviewRetention(document);
    expect(htmlPreviewRetention(document)).toBe(shared);
    const parent = anchor();
    shared.mount(parent, identity());
    observeRetainedHtmlPreviewTabs('t1', 0, new Set(['a']));
    retainHtmlPreviewOwnerTabs('t1', new Set(['a']));
    forgetRetainedHtmlPreviewTab('t1', 'a');
    expect(parent.childElementCount).toBe(0);
    disposeRetainedHtmlPreviews(document);
    expect(htmlPreviewRetention(document)).not.toBe(shared);
  });

  it('uses atomic moves only for connected elements and recreates an externally removed parking host', () => {
    const parent = anchor();
    const child = document.createElement('div');
    moveConnectedElement(parent, child);
    expect(atomicMove).not.toHaveBeenCalled();
    const first = connectedDomParkingHost(document);
    moveConnectedElement(first, child);
    expect(atomicMove).toHaveBeenCalledTimes(1);
    first.remove();
    const second = connectedDomParkingHost(document);
    expect(second).not.toBe(first);
    expect(second.isConnected).toBe(true);
  });
});
