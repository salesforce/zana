/**
 * A doc as the folder a static host serves, and a folder back into a doc:
 * what `zcc design-docs export --out` writes and `import` reads.
 */
import type { DesignDocFile } from '../shared/contract.js';
import { KIT_DIR, KIT_FILES, type SiteFile } from '../shared/page.js';
import type { KitReader } from './pages.js';

export type { SiteFile };

/** Tells GitHub Pages to serve the files as they are rather than run Jekyll (which drops `_folders`). */
export const NO_JEKYLL = '.nojekyll';

/**
 * Everything a static host needs to serve the doc: its own files first, then
 * the kit files its pages load (a doc's own copy wins, as in the preview) and
 * `.nojekyll` when it has pages.
 */
export function siteFiles(files: DesignDocFile[], kit: KitReader): SiteFile[] {
  const site: SiteFile[] = files.map(({ path, content, encoding }) => ({ path, content, encoding }));
  const own = new Set(files.map((file) => file.path));
  const usesKit = files.some((file) => file.encoding === 'utf8' && file.content.includes(`${KIT_DIR}/`));
  if (usesKit) {
    for (const name of KIT_FILES) {
      const path = `${KIT_DIR}/${name}`;
      const source = own.has(path) ? null : kit(name);
      if (source) site.push({ path, content: source.content, encoding: source.encoding });
    }
  }
  if (files.some((file) => file.kind === 'html') && !own.has(NO_JEKYLL)) {
    site.push({ path: NO_JEKYLL, content: '', encoding: 'utf8' });
  }
  return site;
}

/** Why a file of an imported folder stays out of the doc, or null to bring it in. */
export function importSkipReason(path: string): string | null {
  const segments = path.split('/');
  if (segments.some((segment) => segment.startsWith('.'))) return 'hidden';
  if (segments.includes('node_modules')) return 'dependencies';
  if (segments[0] === KIT_DIR) return 'the site kit; Design Docs serves it and export copies it';
  return null;
}

/** `fn` over `items`, at most `limit` at a time; stops starting new work after the first failure. */
export async function mapBounded<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = await fn(items[index]!);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
