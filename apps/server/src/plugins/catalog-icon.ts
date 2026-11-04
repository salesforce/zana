import { closeSync, fstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve } from 'node:path';

const MAX_ICON_BYTES = 64 * 1024;
const IMAGE_TYPES: Record<string, string> = {
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif'
};

/** Small offline catalogue images, including plugins that aren't installed yet. */
export function readCatalogIcon(root: string, icon: string | undefined): string | undefined {
  if (!icon?.startsWith('./')) return undefined;
  const mime = IMAGE_TYPES[extname(icon).toLowerCase()];
  if (!mime) return undefined;
  let fd: number | undefined;
  try {
    const base = realpathSync(root);
    const path = realpathSync(resolve(base, icon));
    const child = relative(base, path);
    if (!child || child === '..' || child.startsWith('../') || child.startsWith('..\\') || isAbsolute(child)) return undefined;
    fd = openSync(path, 'r');
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_ICON_BYTES) return undefined;
    // A capped read also bounds the allocation if the file changes after stat.
    const bytes = Buffer.alloc(MAX_ICON_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length === 0 || length > MAX_ICON_BYTES) return undefined;
    return `data:${mime};base64,${bytes.subarray(0, length).toString('base64')}`;
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
