import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { syncDocs } from './sync-docs.mjs';

const squadSlugs = ['squads-start', 'squads-catalogue', 'squads-launch', 'squads-watch', 'squads-customize'];
let directory: string;
afterEach(async () => {
  vi.restoreAllMocks();
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function setup() {
  directory = await mkdtemp(join(tmpdir(), 'docs-sync-'));
  const website = join(directory, 'website');
  const output = join(website, 'content', 'docs');
  await mkdir(output, { recursive: true });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  return { website, output };
}

it('publishes all site-authored Squad pages without overwriting updated wording on repeated sync', async () => {
  const { website, output } = await setup();
  await mkdir(join(directory, 'docs'));
  await writeFile(join(directory, 'docs', 'using-zana.md'), '# Updated environments');
  for (const slug of squadSlugs) await writeFile(join(output, `${slug}.md`), `# ${slug}\nUse default. Effective settings. Customize launch.`);
  for (let run = 0; run < 2; run++) {
    await syncDocs(directory, website);
    const manifest = JSON.parse(await readFile(join(output, '_manifest.json'), 'utf8'));
    expect(manifest.filter((doc: { group: string }) => doc.group === 'Squads').map((doc: { slug: string }) => doc.slug)).toEqual(squadSlugs);
    expect(await readFile(join(output, 'using-zana.md'), 'utf8')).toBe('# Updated environments');
    for (const slug of squadSlugs) expect(await readFile(join(output, `${slug}.md`), 'utf8')).toBe(`# ${slug}\nUse default. Effective settings. Customize launch.`);
  }
});

it('keeps committed manifest and wording unchanged in website-only builds', async () => {
  const { website, output } = await setup();
  const manifest = JSON.stringify(squadSlugs.map(slug => ({ slug, group: 'Squads' })));
  await writeFile(join(output, '_manifest.json'), manifest);
  await writeFile(join(output, 'squads-launch.md'), '# Effective launch settings');
  await syncDocs(directory, website);
  expect(await readFile(join(output, '_manifest.json'), 'utf8')).toBe(manifest);
  expect(await readFile(join(output, 'squads-launch.md'), 'utf8')).toBe('# Effective launch settings');
});

it('omits missing docs rather than publishing broken routes', async () => {
  const { website, output } = await setup();
  await writeFile(join(directory, 'README.md'), '# Partial checkout');
  await writeFile(join(output, 'squads-launch.md'), '# Launch');
  await syncDocs(directory, website);
  expect(JSON.parse(await readFile(join(output, '_manifest.json'), 'utf8'))).toEqual([
    { slug: 'squads-launch', title: 'Ways to start a Squad', group: 'Squads' }
  ]);
  expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('SKIP squads-start'));
});
