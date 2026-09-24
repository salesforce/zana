import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createGitMaterializationGate,
  materializeMarketplaceIndex,
  parseMarketplaceSource,
  marketplaceSourceDisplay,
  marketplaceSourcesEqual,
  resolveMarketplaceSource
} from './marketplace-source.js';

const dirs: string[] = [];

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => { resolve = settle; });
  return { promise, resolve };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const SAMPLE_INDEX = {
  schemaVersion: 1 as const,
  name: 'official',
  displayName: 'Official',
  plugins: [
    {
      id: 'notes',
      displayName: 'Notes',
      description: 'notes plugin',
      author: { name: 'zana' },
      source: { npm: { package: '@zana/notes', range: '1.0.0' } }
    }
  ]
};

describe('parseMarketplaceSource', () => {
  it('parses HTTPS and SSH Git forms plus paths', () => {
    expect(parseMarketplaceSource('https://example.test/marketplace.json')).toEqual({
      kind: 'https',
      manifestUrl: 'https://example.test/marketplace.json'
    });
    expect(parseMarketplaceSource('git:https://example.test/mp.git')).toEqual({
      kind: 'git',
      url: 'https://example.test/mp.git',
      ref: 'HEAD'
    });
    expect(parseMarketplaceSource('git:https://example.test/mp.git@v1')).toEqual({
      kind: 'git',
      url: 'https://example.test/mp.git',
      ref: 'v1'
    });
    expect(parseMarketplaceSource('git+https://example.test/mp.git@main')).toEqual({
      kind: 'git',
      url: 'https://example.test/mp.git',
      ref: 'main'
    });
    expect(parseMarketplaceSource('git+ssh://git@git.soma.salesforce.com/chatbots/catalog.git@main')).toEqual({
      kind: 'git',
      url: 'ssh://git@git.soma.salesforce.com/chatbots/catalog.git',
      ref: 'main'
    });
    expect(parseMarketplaceSource('git@git.soma.salesforce.com:chatbots/catalog.git')).toEqual({
      kind: 'git',
      url: 'ssh://git@git.soma.salesforce.com/chatbots/catalog.git',
      ref: 'HEAD'
    });
    const parsed = parseMarketplaceSource('path:/tmp/catalog');
    expect(parsed).toEqual({ kind: 'path', directory: resolve('/tmp/catalog') });
  });

  it('refuses plain http and unlabeled sources', () => {
    expect(() => parseMarketplaceSource('http://example.test/mp.json')).toThrow(/https/);
    expect(() => parseMarketplaceSource('example.test/mp.json')).toThrow(/https:\/\/<manifest-url>/);
    expect(() => parseMarketplaceSource('')).toThrow(/invalid marketplace source/);
    expect(() => parseMarketplaceSource('path:')).toThrow(/empty path/);
  });

  it('canonicalizes structured URLs and refuses unsafe URL components', () => {
    expect(parseMarketplaceSource('https://EXAMPLE.test:443/marketplace.json')).toEqual({
      kind: 'https',
      manifestUrl: 'https://example.test/marketplace.json'
    });
    expect(parseMarketplaceSource('git+https://EXAMPLE.test:443/org/catalog@main')).toEqual({
      kind: 'git',
      url: 'https://example.test/org/catalog',
      ref: 'main'
    });
    for (const source of [
      'https://user@example.test/marketplace.json',
      'https://example.test/marketplace.json?token=secret',
      'git:https://example.test/catalog#main',
      'git:https://user@example.test/catalog',
      'git+ssh://user@git.soma.salesforce.com/catalog'
    ]) {
      expect(() => parseMarketplaceSource(source)).toThrow(/refused/);
    }
    expect(() => parseMarketplaceSource('https://example.test/marketplace.json?token=secret'))
      .not.toThrow('token=secret');
  });

  it('resolves bare repository-shaped HTTPS sources manifest-first with a git fallback', () => {
    const source = parseMarketplaceSource('https://example.test/team/catalog');
    expect(resolveMarketplaceSource(source)).toEqual([
      { kind: 'https', manifestUrl: 'https://example.test/team/catalog' },
      { kind: 'git', url: 'https://example.test/team/catalog', ref: 'HEAD' }
    ]);
    expect(resolveMarketplaceSource(parseMarketplaceSource('https://example.test/marketplace.json'))).toHaveLength(1);
  });

  it('round-trips display strings', () => {
    expect(marketplaceSourceDisplay(parseMarketplaceSource('https://example.test/mp.json')))
      .toBe('https://example.test/mp.json');
    expect(marketplaceSourceDisplay(parseMarketplaceSource('git:https://example.test/mp.git')))
      .toBe('git:https://example.test/mp.git');
    expect(marketplaceSourceDisplay(parseMarketplaceSource('git:https://example.test/mp.git@v2')))
      .toBe('git:https://example.test/mp.git@v2');
  });

  it('treats git URLs with and without a .git suffix as the same source', () => {
    expect(marketplaceSourcesEqual(
      'git:https://git.soma.salesforce.com/chatbots/zana-internal-marketplace.git',
      'git:https://git.soma.salesforce.com/chatbots/zana-internal-marketplace'
    )).toBe(true);
    expect(marketplaceSourcesEqual(
      'https://example.test/a.json',
      'https://example.test/b.json'
    )).toBe(false);
  });
});

describe('materializeMarketplaceIndex', () => {
  it('reads a path: directory through marketplace.json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-mp-path-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'marketplace.json'), JSON.stringify(SAMPLE_INDEX));
    const index = await materializeMarketplaceIndex({ kind: 'path', directory: dir });
    expect(index.name).toBe('official');
    expect(index.plugins).toHaveLength(1);
  });

  it('fetches https catalogs through the injected fetch', async () => {
    const index = await materializeMarketplaceIndex(
      { kind: 'https', manifestUrl: 'https://example.test/mp.json' },
      async (url) => {
        expect(url).toBe('https://example.test/mp.json');
        return SAMPLE_INDEX;
      }
    );
    expect(index.displayName).toBe('Official');
  });

  it('does not try a git fallback when a manifest resolves', async () => {
    const index = await materializeMarketplaceIndex(
      parseMarketplaceSource('https://example.test/team/catalog'),
      async () => SAMPLE_INDEX
    );
    expect(index.name).toBe('official');
  });

  it('does not fall back to Git after a network failure', async () => {
    await expect(materializeMarketplaceIndex(
      parseMarketplaceSource('https://example.test/team/catalog'),
      async () => {
        throw new Error('marketplace fetch failed: 401');
      }
    )).rejects.toThrow(/401/);
  });

  it('refuses a path that is a file, not a directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-mp-file-'));
    dirs.push(dir);
    const file = join(dir, 'not-a-dir');
    writeFileSync(file, '{}');
    await expect(materializeMarketplaceIndex({ kind: 'path', directory: file }))
      .rejects.toThrow(/does not exist/);
  });

  it('refuses a missing marketplace.json inside an otherwise valid directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-mp-empty-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'nested'));
    await expect(materializeMarketplaceIndex({ kind: 'path', directory: dir }))
      .rejects.toThrow();
  });

  it('clones a local git catalog', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'zcc-mp-git-'));
    dirs.push(repo);
    writeFileSync(join(repo, 'marketplace.json'), JSON.stringify(SAMPLE_INDEX));
    const gitEnv = {
      ...process.env,
      GIT_AUTHOR_NAME: 'T',
      GIT_AUTHOR_EMAIL: 't@example.com',
      GIT_COMMITTER_NAME: 'T',
      GIT_COMMITTER_EMAIL: 't@example.com'
    };
    const run = (args: string[]) => {
      const result = spawnSync('git', args, { cwd: repo, env: gitEnv, encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`);
    };
    run(['init', '-b', 'main']);
    run(['add', 'marketplace.json']);
    run(['commit', '-m', 'init']);
    const index = await materializeMarketplaceIndex({ kind: 'git', url: repo, ref: 'HEAD' });
    expect(index.name).toBe('official');
    expect(index.plugins).toHaveLength(1);
  });

  it('limits Git materialization to two FIFO lifecycles', async () => {
    const firstTwoStarted = deferred();
    const thirdStarted = deferred();
    const releases = [deferred(), deferred(), deferred()];
    let started = 0;
    let active = 0;
    let peak = 0;
    const runGit = async (args: string[]) => {
      const index = started++;
      active += 1;
      peak = Math.max(peak, active);
      if (started === 2) firstTwoStarted.resolve();
      if (started === 3) thirdStarted.resolve();
      await releases[index]!.promise;
      writeFileSync(join(args.at(-1)!, 'marketplace.json'), JSON.stringify(SAMPLE_INDEX));
      active -= 1;
      return '';
    };
    const source = (id: string) => ({ kind: 'git' as const, url: `https://example.test/${id}`, ref: 'HEAD' });
    const withGitMaterializationSlot = createGitMaterializationGate();
    const jobs = ['one', 'two', 'three'].map((id) => materializeMarketplaceIndex(
      source(id),
      undefined,
      { runGit, withGitMaterializationSlot }
    ));

    await firstTwoStarted.promise;
    expect(started).toBe(2);
    expect(peak).toBe(2);

    releases[0]!.resolve();
    await thirdStarted.promise;
    expect(peak).toBe(2);

    releases[1]!.resolve();
    releases[2]!.resolve();
    await expect(Promise.all(jobs)).resolves.toHaveLength(3);
  });

  it('releases Git materialization slot after clone error', async () => {
    const secondStarted = deferred();
    const thirdStarted = deferred();
    const failFirst = deferred();
    const releases = [deferred(), deferred()];
    let started = 0;
    const runGit = async (args: string[]) => {
      const index = started++;
      if (index === 0) {
        await failFirst.promise;
        throw new Error('clone failed');
      }
      if (index === 1) secondStarted.resolve();
      if (index === 2) thirdStarted.resolve();
      await releases[index - 1]!.promise;
      writeFileSync(join(args.at(-1)!, 'marketplace.json'), JSON.stringify(SAMPLE_INDEX));
      return '';
    };
    const source = (id: string) => ({ kind: 'git' as const, url: `https://example.test/${id}`, ref: 'HEAD' });
    const withGitMaterializationSlot = createGitMaterializationGate();
    const first = materializeMarketplaceIndex(source('fail'), undefined, { runGit, withGitMaterializationSlot });
    const firstOutcome = first.then(
      () => 'fulfilled' as const,
      (error: unknown) => error
    );
    const second = materializeMarketplaceIndex(source('blocked'), undefined, { runGit, withGitMaterializationSlot });
    const third = materializeMarketplaceIndex(source('queued'), undefined, { runGit, withGitMaterializationSlot });

    await secondStarted.promise;
    expect(started).toBe(2);
    failFirst.resolve();
    await expect(firstOutcome).resolves.toBeInstanceOf(Error);
    await thirdStarted.promise;

    releases[0]!.resolve();
    releases[1]!.resolve();
    await expect(Promise.all([second, third])).resolves.toHaveLength(2);
  });

  it('times out a hung git clone when timeoutMs is set', async () => {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => resolve());
      server.on('error', reject);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      throw new Error('expected a TCP port');
    }
    server.unref();
    try {
      await expect(materializeMarketplaceIndex(
        { kind: 'git', url: `http://127.0.0.1:${address.port}/marketplace.git`, ref: 'HEAD' },
        undefined,
        { timeoutMs: 400, nonInteractive: true, withGitMaterializationSlot: createGitMaterializationGate() }
      )).rejects.toThrow(/timed out/);
    } finally {
      server.close();
    }
  }, 10_000);
});
