import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { MAX_NOTES_CHARS, checkReleaseNotes, runReleaseNotesCli, runReleaseNotesGuard } from './check-release-notes.mjs';
import { MAX_UPDATE_NOTE_CHARS } from '../apps/desktop/src/update-release-notes.js';

const GOOD = '# What’s new in 1.2.3\n\n**Headline.** A sentence long enough to count as real release notes for this version.\n\n- Item with `<tag>` and `a | b` in code.';

describe('checkReleaseNotes', () => {
  it('accepts notes in the supported markdown subset', () => {
    expect(checkReleaseNotes({ version: '1.2.3', body: GOOD })).toEqual([]);
    expect(checkReleaseNotes({ version: '1.2.3', body: GOOD + '\n\n```\n<div>| x |</div>\n```', tag: 'v1.2.3' })).toEqual([]);
  });

  it('fails a missing or stub file', () => {
    expect(checkReleaseNotes({ version: '1.2.3', body: null })[0]).toMatch(/missing docs\/releases\/1\.2\.3\.md/);
    expect(checkReleaseNotes({ version: '1.2.3', body: '# 1.2.3' })[0]).toMatch(/too short/);
  });

  it('fails notes the update banner preview would truncate or drop', () => {
    expect(checkReleaseNotes({ version: '1.2.3', body: GOOD + 'x'.repeat(MAX_NOTES_CHARS) }).join()).toMatch(/truncates/);
    expect(checkReleaseNotes({ version: '1.2.3', body: GOOD + '\n\n![shot](https://x.test/a.png)' }).join()).toMatch(/an image/);
    expect(checkReleaseNotes({ version: '1.2.3', body: GOOD + '\n\n| a | b |\n|---|---|' }).join()).toMatch(/a table/);
    expect(checkReleaseNotes({ version: '1.2.3', body: GOOD + '\n\n<details>more</details>' }).join()).toMatch(/raw HTML \(near line 7\)/);
  });

  it('fails a release tag that does not match package.json, ignoring branch refs', () => {
    expect(checkReleaseNotes({ version: '1.2.3', body: GOOD, tag: 'v1.2.4' })[0]).toMatch(/does not match/);
    expect(checkReleaseNotes({ version: '1.2.3', body: GOOD, tag: 'main' })).toEqual([]);
    expect(checkReleaseNotes({ version: '1.2.3', body: GOOD, tag: 'version/2.1.1' })).toEqual([]);
  });

  it('keeps the size cap in lockstep with the app’s preview cap', () => {
    expect(MAX_NOTES_CHARS).toBe(MAX_UPDATE_NOTE_CHARS);
  });

  it('passes every shipped release note', () => {
    const dir = new URL('../docs/releases/', import.meta.url);
    for (const name of readdirSync(dir).filter((n) => /^\d+\.\d+\.\d+\.md$/.test(n))) {
      const version = name.replace(/\.md$/, '');
      expect(checkReleaseNotes({ version, body: readFileSync(new URL(name, dir), 'utf8') }), name).toEqual([]);
    }
  });
});

describe('release-notes executable', () => {
  it('runs only when loaded as the CLI entrypoint', () => {
    const previous = process.exitCode;
    const run = vi.fn(() => 1);
    try {
      runReleaseNotesCli(false, run);
      expect(run).not.toHaveBeenCalled();
      runReleaseNotesCli(true, run);
      expect(run).toHaveBeenCalledOnce();
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previous;
    }
  });

  it.each([
    { name: 'valid release', body: GOOD, tag: 'v1.2.3', status: 0, output: 'present' },
    { name: 'missing notes', body: null, tag: 'main', status: 1, output: 'missing docs/releases/1.2.3.md' },
    { name: 'mismatched tag', body: GOOD, tag: 'v1.2.4', status: 1, output: 'does not match package.json version' },
    { name: 'unsupported markup', body: `${GOOD}\n\n<img src="missing.png">`, tag: 'main', status: 1, output: 'raw HTML' }
  ])('checks the package version and exits correctly for $name', ({ body, tag, status, output }) => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-release-notes-cli-'));
    try {
      mkdirSync(join(root, 'scripts'));
      mkdirSync(join(root, 'docs', 'releases'), { recursive: true });
      const script = join(root, 'scripts', 'check-release-notes.mjs');
      copyFileSync(new URL('./check-release-notes.mjs', import.meta.url), script);
      writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }));
      if (body !== null) writeFileSync(join(root, 'docs', 'releases', '1.2.3.md'), body);
      const messages: string[] = [];
      expect(runReleaseNotesGuard({ root, tag, log: (line: string) => messages.push(line), error: (line: string) => messages.push(line) })).toBe(status);
      expect(messages.join('\n')).toContain(output);
      const result = spawnSync(process.execPath, [script], {
        cwd: root, env: { ...process.env, GITHUB_REF_NAME: tag }, encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(status);
      expect(result.stdout + result.stderr).toContain(output);
      if (status === 0) expect(result.stderr).toBe('');
      else expect(result.stdout).toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
