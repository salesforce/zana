function currentPlatform(): string {
  return typeof navigator === 'undefined' ? '' : navigator.platform;
}

/**
 * Name of the OS file manager that "Reveal" opens, for use mid-sentence:
 * Finder on macOS, Explorer on Windows, a generic "file manager" elsewhere
 * (Linux reveals through whichever file manager the desktop provides).
 */
export function fileManagerName(platform = currentPlatform()): string {
  const p = platform.toUpperCase();
  if (p.includes('MAC')) return 'Finder';
  if (p.startsWith('WIN')) return 'Explorer';
  return 'file manager';
}

/** {@link fileManagerName} capitalized, for Settings labels. */
export function fileManagerTitle(platform = currentPlatform()): string {
  const name = fileManagerName(platform);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** One-line description of the "Reveal" opener for Settings → Editor. */
export function fileManagerBlurb(platform = currentPlatform()): string {
  switch (fileManagerName(platform)) {
    case 'Finder': return 'Reveals a path in the macOS Finder.';
    case 'Explorer': return 'Reveals a path in Windows File Explorer.';
    default: return 'Reveals a path in the system file manager.';
  }
}
