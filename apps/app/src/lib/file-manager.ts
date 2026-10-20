/**
 * Name of the OS file manager that "Reveal" opens: Explorer on Windows,
 * Finder everywhere else (the opener only targets macOS Finder otherwise).
 */
export function fileManagerName(
  platform = typeof navigator === 'undefined' ? '' : navigator.platform
): string {
  return platform.toUpperCase().startsWith('WIN') ? 'Explorer' : 'Finder';
}

/** One-line description of the "Reveal" opener for Settings → Editor. */
export function fileManagerBlurb(platform?: string): string {
  return fileManagerName(platform) === 'Explorer'
    ? 'Reveals a path in Windows File Explorer.'
    : 'Reveals a path in the macOS Finder.';
}
