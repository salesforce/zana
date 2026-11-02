import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { syncHelpVideos } from './sync-help-videos.mjs';

it('syncs metadata and preserves the snapshot in a website-only build', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'help-videos-sync-'));
  try {
    const source = join(directory, 'catalogue.json');
    const destination = join(directory, 'website/content/videos/catalogue.json');
    await writeFile(source, '{"version":1}');
    await syncHelpVideos(source, destination);
    expect(await readFile(destination, 'utf8')).toBe('{"version":1}');
    await rm(source);
    await syncHelpVideos(source, destination);
    expect(await readFile(destination, 'utf8')).toBe('{"version":1}');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
