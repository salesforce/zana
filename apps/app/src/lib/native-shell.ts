import {
  NATIVE_BRIDGE_GLOBAL,
  parseNativeShellHandshake,
  parseShellToPageEvent,
  type NativeShellApi
} from '@zana-ai/zcc-mobile-bridge';

/** This bridge offers device UI only. Product authorization stays on the server. */
export function getNativeShell(): NativeShellApi | null {
  if (typeof window === 'undefined') return null;
  const root = (window as unknown as Record<string, unknown>)[NATIVE_BRIDGE_GLOBAL];
  if (!root || typeof root !== 'object') return null;
  const native = (root as { native?: Partial<NativeShellApi> }).native;
  if (
    !native ||
    typeof native.post !== 'function' ||
    typeof native.request !== 'function' ||
    typeof native.subscribe !== 'function'
  )
    return null;
  const parsed = parseNativeShellHandshake({
    bridgeVersion: native.bridgeVersion,
    appVersion: native.appVersion,
    platform: native.platform,
    profileMode: native.profileMode,
    secureContext: native.secureContext,
    safeArea: native.safeArea,
    capabilities: native.capabilities
  });
  return parsed ? (native as NativeShellApi) : null;
}

export function installNativeShellEvents(onResume: () => void): () => void {
  const shell = getNativeShell();
  if (!shell) return () => {};
  const off = shell.subscribe((raw) => {
    const event = parseShellToPageEvent(raw);
    if (event?.type === 'resume') onResume();
  });
  shell.post({ type: 'ready', path: window.location.pathname + window.location.search });
  return off;
}
