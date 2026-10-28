/**
 * The effective theme a new window opens with, before its renderer has read
 * the config. Main paints the native window background in the page's
 * --bg-base, and hands the theme to the preload (`--zcc-theme=`), which seeds
 * `<html data-theme>` before the stylesheet applies. Without both, a light
 * window shows the dark background until the renderer's `applyTheme` runs.
 *
 * BG_BASE must match --bg-base in apps/app/src/styles/global.css, in both
 * `:root` (dark) and `:root[data-theme='light']` (checked by
 * window-theme.test.ts).
 */
export type EffectiveTheme = 'dark' | 'light';

export const BG_BASE = {
  dark: '#181818',
  light: '#f6f8fa'
} as const satisfies Record<EffectiveTheme, string>;

export const THEME_ARG_PREFIX = '--zcc-theme=';

/**
 * Resolve the stored tri-state `theme` to a concrete theme. 'system' (or an
 * unknown value) follows the OS. An unset theme is dark, the config default,
 * the same as the renderer's `applyTheme`.
 */
export function resolveThemeSetting(theme: string | undefined, osDark: () => boolean): EffectiveTheme {
  if (theme === undefined || theme === 'dark') return 'dark';
  if (theme === 'light') return 'light';
  return osDark() ? 'dark' : 'light';
}

/**
 * The BrowserWindow background and the preload argument for the effective
 * theme. A failed theme read must not stop a window from opening: it logs and
 * falls back to the default (dark) theme.
 */
export function windowThemeOptions(
  theme: () => EffectiveTheme,
  logError: (context: string, err: unknown) => void
): { backgroundColor: string; themeArg: string } {
  let effective: EffectiveTheme = 'dark';
  try {
    effective = theme();
  } catch (err) {
    logError('window theme', err);
  }
  return { backgroundColor: BG_BASE[effective], themeArg: `${THEME_ARG_PREFIX}${effective}` };
}

/** The theme main passed in argv, or null when it's missing or malformed. */
export function themeFromArgv(argv: readonly string[]): EffectiveTheme | null {
  const value = argv.find((arg) => arg.startsWith(THEME_ARG_PREFIX))?.slice(THEME_ARG_PREFIX.length);
  return value === 'dark' || value === 'light' ? value : null;
}

interface SeedDocument {
  readonly documentElement: { dataset: Record<string, string | undefined> } | null;
}

type SeedObserver<D> = new (callback: () => void) => {
  observe(target: D, options: { childList: boolean }): void;
  disconnect(): void;
};

/**
 * Set `<html data-theme>` from argv as soon as the element exists. A preload
 * runs before the parser has created `<html>`, so this waits for it with a
 * MutationObserver, whose callback runs before the first paint. A theme the
 * page already set is left alone; `applyTheme` replaces the seed once the
 * config loads. No document (a preload loaded in a unit test) does nothing.
 */
export function seedDocumentTheme<D extends SeedDocument>(
  argv: readonly string[],
  doc: D | undefined,
  Observer: SeedObserver<NoInfer<D>>
): void {
  const theme = themeFromArgv(argv);
  if (!theme || !doc) return;
  const seed = () => {
    const root = doc.documentElement;
    if (!root) return false;
    root.dataset.theme ??= theme;
    return true;
  };
  if (seed()) return;
  const watch = new Observer(() => {
    if (seed()) watch.disconnect();
  });
  watch.observe(doc, { childList: true });
}
