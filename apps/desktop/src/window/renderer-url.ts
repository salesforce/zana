/**
 * One renderer-origin policy for the main window and menu-bar popover. The
 * production origin is set only after the local static server is listening;
 * renderer code never supplies it and never receives its control capability.
 */
let productionOrigin: string | null = null;

export function setProductionRendererOrigin(value: string): void {
  const parsed = new URL(value);
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') {
    throw new Error('Production renderer must use the supervised loopback static host');
  }
  productionOrigin = parsed.origin;
}

export function rendererUrl(params: Record<string, string | undefined> = {}): string | null {
  const devUrl = process.env.ZCC_DESKTOP_APP_URL || process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    const url = new URL(devUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
    return url.toString();
  }
  if (!productionOrigin) return null;
  const url = new URL('/', productionOrigin);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}

export function isTrustedRendererUrl(value: string): boolean {
  const target = rendererUrl();
  if (target) {
    try {
      return new URL(value).origin === new URL(target).origin;
    } catch {
      return false;
    }
  }
  // Startup repair runs before normal services (including the static host) are
  // available. Its file-backed surface is deliberately isolated and temporary.
  return value.startsWith('file://');
}
