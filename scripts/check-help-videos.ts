import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { HELP_VIDEO_CATALOGUE_MAX_BYTES, helpVideoCatalogueSchema } from '../packages/server-contract/src/help-videos.js';

/** Validate exactly what installed clients accept, including every immutable asset. */
export async function checkHelpVideos(root: string): Promise<number> {
  const cataloguePath = join(root, 'content/videos/catalogue.json');
  if ((await stat(cataloguePath)).size > HELP_VIDEO_CATALOGUE_MAX_BYTES) throw new Error('Catalogue exceeds 128 KiB');
  const source = await readFile(cataloguePath);
  const catalogue = helpVideoCatalogueSchema.parse(JSON.parse(source.toString('utf8')));
  const mediaRoot = await realpath(join(root, 'content/videos/media'));
  for (const video of catalogue.videos) {
    for (const asset of [video.src, video.poster, video.captions]) {
      const path = await realpath(join(root, asset.path));
      if (!path.startsWith(`${mediaRoot}${sep}`)) throw new Error(`Asset escapes media directory: ${asset.path}`);
      if ((await stat(path)).size !== asset.bytes) throw new Error(`Asset integrity mismatch: ${asset.path}`);
      const data = await readFile(path);
      if (data.length !== asset.bytes || createHash('sha256').update(data).digest('hex') !== asset.sha256) {
        throw new Error(`Asset integrity mismatch: ${asset.path}`);
      }
    }
  }
  return catalogue.videos.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const count = await checkHelpVideos(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
  console.log(`Help video catalogue valid: ${count} videos, all assets verified.`);
}
