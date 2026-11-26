import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import { checkDocs, parseNameStatus, runDocsCheck } from './check-pr-docs.mjs';

const ui = 'apps/app/src/views/Bots.tsx';
const edited = (...paths: string[]) => paths.map(path => ({ path, status: 'M' }));
const noManifest = () => undefined;

it.each([
  ui, 'apps/mobile/src/settings.tsx', 'apps/server/src/http/product-config.ts',
  'packages/cli/src/lib/commands/thread.ts', 'packages/control-sdk/src/client.ts',
  'packages/plugin-sdk/src/server.ts', 'packages/extension-sdk/src/index.ts',
  'packages/domain/src/config.ts', 'apps/desktop/src/ipc/settings.ts',
  'plugins/bots/app.tsx', 'plugins/bots/src/screens/Settings.tsx', 'plugins/bots/src/cli.ts'
])('requires docs for %s', path => {
  expect(checkDocs(edited(path), {}, noManifest)).toMatchObject({
    error: expect.stringContaining('Update a user guide'), affected: [path]
  });
});

it.each([
  'docs/using-zana.md', 'docs/releases/2.7.0.md', 'website/content/docs/squads-start.md',
  'plugins/bots/PLUGIN_OVERVIEW.md', 'content/videos/catalogue.json'
])('accepts a change to %s', path => {
  expect(checkDocs(edited(ui, path), {}, noManifest)).toHaveProperty('message');
});

it('exempts internal code, tests, fixtures, stories, scripts, CI, and dependency-only edits', () => {
  const read = vi.fn(() => ({ app: './app.tsx' }));
  expect(checkDocs(edited(
    'packages/db/src/db.ts', 'packages/domain/src/events.ts',
    'apps/app/src/views/Bots.test.tsx', 'apps/app/src/views/Bots.stories.tsx',
    'apps/app/src/views/__fixtures__/bots.json', 'apps/app/src/views/fixtures/data.json',
    'apps/server/src/http/__tests__/routes.ts', 'scripts/verify.mjs',
    'e2e/bots-workbench.spec.ts', '.github/workflows/ci.yml', 'docker/Dockerfile', 'pnpm-lock.yaml',
    'plugins/bots/package.json', 'docs/using-zana.md'
  ), {}, read)).toEqual({ message: 'No changes to covered user-facing paths.' });
  expect(read).toHaveBeenCalledTimes(2);
});

it('treats plugin metadata changes and new plugin manifests as user-facing', () => {
  const path = 'plugins/bots/package.json';
  const read = vi.fn(revision => ({ description: revision }));
  expect(checkDocs(edited(path), {}, read)).toMatchObject({ affected: [path] });
  expect(checkDocs([{ path, status: 'A' }], {}, read)).toMatchObject({ affected: [path] });
  expect(checkDocs([{ path, status: 'D' }], {}, read)).toMatchObject({ affected: [path] });
});

it('does not count the generated catalog, README files or contributor instructions', () => {
  const changes = edited(ui, 'README.md', 'docs/media/README.md', 'AGENTS.md',
    'docs/releases/AGENTS.md', 'plugins/bots/src/helper/catalog.generated.json');
  expect(checkDocs(changes, {}, noManifest)).toMatchObject({ affected: [ui] });
});

it('accepts removal of a guide when a user-facing surface is removed', () => {
  const changes = [{ path: ui, status: 'D' }, { path: 'docs/example.md', status: 'D' }];
  expect(checkDocs(changes, {}, noManifest)).toHaveProperty('message');
});

it('requires both the exact exception label and a reason on its own line', () => {
  const labels = [{ name: 'no-docs-needed' }];
  const changes = edited(ui);
  const body = 'Docs exception reason: <!-- Fill when requesting the label. --> Internal refactor with the same behavior.';
  expect(checkDocs(changes, { labels, body }, noManifest)).toHaveProperty('message');
  expect(checkDocs(changes, { body }, noManifest)).toHaveProperty('error');
  expect(checkDocs(changes, { labels: [{ name: 'needs-docs' }], body }, noManifest)).toHaveProperty('error');
  expect(checkDocs(changes, { labels }, noManifest)).toHaveProperty('error');
  expect(checkDocs(changes, { labels, body: 'Docs exception reason:\n## Other' }, noManifest)).toHaveProperty('error');
  expect(checkDocs(changes, { labels, body: 'Docs exception reason: <!-- Fill in later. -->' }, noManifest)).toHaveProperty('error');
});

it('parses changed paths containing spaces and validates the exact PR range in Git', () => {
  expect(parseNameStatus('M\0docs/a guide.md\0D\0' + ui + '\0')).toEqual([
    { status: 'M', path: 'docs/a guide.md' }, { status: 'D', path: ui }
  ]);
  const dir = mkdtempSync(join(tmpdir(), 'zana-docs-check-'));
  try {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
    const write = (path: string, contents: string) => {
      const target = join(dir, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, contents);
    };
    const commit = (message: string) => {
      git('add', '.');
      git('commit', '-m', message);
      return git('rev-parse', 'HEAD');
    };
    git('init', '-q');
    git('config', 'user.name', 'Docs test');
    git('config', 'user.email', 'docs@example.test');
    git('config', 'commit.gpgsign', 'false');
    git('config', 'core.hooksPath', join(dir, 'empty-hooks'));
    const manifest = 'plugins/check/package.json';
    const metadata = { app: './app.tsx', name: 'Check' };
    write(manifest, JSON.stringify({ zcc: metadata }));
    write(ui, 'export const label = "Old";\n');
    const base = commit('base');
    write(manifest, JSON.stringify({ dependencies: { example: '^1.0.0' }, zcc: metadata }));
    const dependenciesOnly = commit('update dependency');
    write(ui, 'export const label = "New";\n');
    const missingDocs = commit('update UI');
    write('docs/a guide.md', '# Use the new setting\n');
    const withDocs = commit('update guide');
    const event = join(dir, 'event.json');
    const setHead = (head: string) => {
      writeFileSync(event, JSON.stringify({ pull_request: { base: { sha: base }, head: { sha: head } } }));
    };
    const output = { log: vi.fn(), error: vi.fn() };
    setHead(dependenciesOnly);
    expect(runDocsCheck(event, dir, output)).toBe(0);
    expect(output.log).toHaveBeenLastCalledWith('No changes to covered user-facing paths.');
    setHead(missingDocs);
    expect(runDocsCheck(event, dir, output)).toBe(1);
    expect(output.error).toHaveBeenLastCalledWith('Covered files:', JSON.stringify(ui));
    setHead(withDocs);
    expect(runDocsCheck(event, dir, output)).toBe(0);
    expect(output.log).toHaveBeenLastCalledWith(expect.stringContaining('updates documentation'));

    setHead(missingDocs);
    const script = fileURLToPath(new URL('./check-pr-docs.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_PATH: event } });
    expect(result).toMatchObject({ status: 1, stderr: expect.stringContaining(ui) });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
