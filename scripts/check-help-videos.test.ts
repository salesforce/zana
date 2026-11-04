import { mkdtemp, mkdir, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import catalogue from '../content/videos/catalogue.json';
import { checkHelpVideos } from './check-help-videos.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'check-help-videos-')); roots.push(root);
  await mkdir(join(root, 'content/videos/media'), { recursive: true });
  const value = { version: 1, videos: [structuredClone(catalogue.videos[0])] };
  await writeFile(join(root, 'content/videos/catalogue.json'), JSON.stringify(value));
  for (const asset of [value.videos[0].src, value.videos[0].poster, value.videos[0].captions]) {
    await writeFile(join(root, asset.path), await readFile(resolve(asset.path)));
  }
  return { root, value };
}

it('validates all published assets in the checkout (the CI content integrity gate)', async () => {
  expect(await checkHelpVideos(resolve('.'))).toBe(catalogue.videos.length);
});
it.each(['size', 'hash'])('rejects files whose contents differ from their recorded %s', async mode => {
  const { root, value } = await fixture();
  await writeFile(join(root, value.videos[0].src.path), mode === 'size' ? 'corrupt' : Buffer.alloc(value.videos[0].src.bytes));
  await expect(checkHelpVideos(root)).rejects.toThrow('integrity mismatch');
});
it('rejects symlinks outside the media root and oversized catalogues', async () => {
  const { root, value } = await fixture();
  const asset = join(root, value.videos[0].src.path);
  await rm(asset); await symlink(resolve(value.videos[0].src.path), asset);
  await expect(checkHelpVideos(root)).rejects.toThrow('escapes media directory');
  await writeFile(join(root, 'content/videos/catalogue.json'), 'x'.repeat(128 * 1024 + 1));
  await expect(checkHelpVideos(root)).rejects.toThrow('128 KiB');
});
