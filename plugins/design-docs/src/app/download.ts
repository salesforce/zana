/** "Download" for a doc: its site files zipped in one folder, saved through the browser. */
import type { SiteFile } from '../shared/page.js';
import { zipFiles } from '../shared/zip.js';

function fileBytes(file: SiteFile): Uint8Array {
  if (file.encoding === 'utf8') return new TextEncoder().encode(file.content);
  const binary = atob(file.content);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** The files under `<slug>/`, so unzipping gives one folder named after the doc. */
export function siteZip(slug: string, files: readonly SiteFile[], at?: Date): Uint8Array {
  return zipFiles(
    files.map((file) => ({ path: `${slug}/${file.path}`, data: fileBytes(file) })),
    at
  );
}

/** How long the object URL outlives the click, so the browser can finish reading it. */
const REVOKE_AFTER_MS = 30_000;

export function saveBytes(name: string, bytes: Uint8Array, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}
