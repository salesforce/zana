/**
 * Shortcut labels for the plugin UI. The key handlers accept ⌘ or Ctrl, so
 * macOS shows `⌘P` and Windows/Linux show `Ctrl+P`. Plugins cannot import the
 * core app's platformShortcut helper, hence this small copy.
 */
function currentPlatform(): string {
  return typeof navigator === 'undefined' ? '' : navigator.platform;
}

export function isMacPlatform(platform = currentPlatform()): boolean {
  return /^(Mac|iPhone|iPad|iPod)/i.test(platform);
}

/** `modShortcut('P')` → `⌘P` on macOS, `Ctrl+P` elsewhere; `Enter` shows as `↵` on macOS. */
export function modShortcut(key: string, platform = currentPlatform()): string {
  if (isMacPlatform(platform)) return `⌘${key === 'Enter' ? '↵' : key}`;
  return `Ctrl+${key}`;
}
