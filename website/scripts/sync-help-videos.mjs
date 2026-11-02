import { existsSync } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Only metadata is bundled; immutable media stays in the shared public feed. */
export async function syncHelpVideos(source, destination) {
  if (!existsSync(source)) return; // Website-only builds retain the committed snapshot.
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

const website = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await syncHelpVideos(
    resolve(website, '../content/videos/catalogue.json'),
    resolve(website, 'content/videos/catalogue.json')
  );
}
