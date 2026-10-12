import { describe, expect, it } from 'vitest';
import { buildPublishPrompt, pagesUrl, parsePublishTarget } from './publish.js';

const doc = { id: 'dd_1', slug: 'collab', title: 'Real-time "collab"', entryPath: 'index.html' };

describe('parsePublishTarget', () => {
  it('accepts clone URLs and branch names', () => {
    expect(parsePublishTarget({ branch: 'main' })).toEqual({ repo: null, branch: 'main', folder: 'root' });
    expect(parsePublishTarget({ repo: '  ', branch: ' gh-pages ', folder: 'docs' })).toEqual({ repo: null, branch: 'gh-pages', folder: 'docs' });
    for (const repo of [
      'https://github.com/owner/repo',
      'https://git.soma.salesforce.com/grebmann/agentforce-builder-collaboration-design.git',
      'ssh://git@github.com:22/owner/repo.git',
      'git@github.com:owner/repo.git'
    ]) {
      expect(parsePublishTarget({ repo, branch: 'release/v1.2' }).repo).toBe(repo);
    }
  });

  it('rejects anything that is not a plain clone URL, branch or folder', () => {
    for (const repo of ['http://github.com/o/r', 'https://github.com/o', 'file:///tmp/r', 'https://github.com/o/r\nrm -rf /', 'https://github.com/o/r; ls', 'https://h/o/r/extra']) {
      expect(() => parsePublishTarget({ repo, branch: 'main' })).toThrow(/clone URL/);
    }
    expect(() => parsePublishTarget({ repo: `https://github.com/o/${'r'.repeat(300)}`, branch: 'main' })).toThrow(/at most 300/);
    for (const branch of ['', '-x', '/x', 'x/', 'x.', 'x.lock', 'a..b', 'a//b', 'a b', 'a~1', 'x'.repeat(101), 42]) {
      expect(() => parsePublishTarget({ branch })).toThrow(/branch/);
    }
    expect(() => parsePublishTarget({ branch: 'main', folder: 'site' })).toThrow(/root or docs/);
  });
});

describe('pagesUrl', () => {
  it('maps github.com and GitHub Enterprise repositories to their Pages URL', () => {
    expect(pagesUrl('https://github.com/Owner/repo.git')).toBe('https://Owner.github.io/repo/');
    expect(pagesUrl('git@github.com:owner/owner.github.io.git')).toBe('https://owner.github.io/');
    expect(pagesUrl('https://git.soma.salesforce.com/grebmann/design-site')).toBe('https://git.soma.salesforce.com/pages/grebmann/design-site/');
    expect(pagesUrl('ssh://git@GHE.example.com:2222/team/site.git')).toBe('https://ghe.example.com/pages/team/site/');
    expect(pagesUrl('not a url')).toBeNull();
  });
});

describe('buildPublishPrompt', () => {
  it('briefs a push to another repository', () => {
    const prompt = buildPublishPrompt({ doc, target: { repo: 'https://github.com/o/site', branch: 'gh-pages', folder: 'docs' } });
    expect(prompt).toContain('to the repository https://github.com/o/site, branch gh-pages, folder /docs');
    expect(prompt).toContain('zcc design-docs export dd_1 --out .zcc/tmp/publish-collab');
    expect(prompt).toContain('Clone https://github.com/o/site');
    expect(prompt).toContain('docs/ of the clone');
    expect(prompt).toContain('4. Commit only the exported files with the message "Publish design doc: Real-time \'collab\'"');
    expect(prompt).toContain('Never force-push');
    expect(prompt).toContain('(expected https://o.github.io/site/)');
    expect(prompt).toContain('folder /docs. End with ::design-doc{id="dd_1"}');
  });

  it("briefs a push to the project's own repository", () => {
    const prompt = buildPublishPrompt({ doc: { ...doc, entryPath: 'README.md' }, target: { repo: null, branch: 'main', folder: 'root' } });
    expect(prompt).toContain("to this project's repository, branch main, its root");
    expect(prompt).toContain('zcc design-docs export dd_1 --out .');
    expect(prompt).toContain('stop and ask the user before switching');
    expect(prompt).toContain('3. Commit only');
    expect(prompt).toContain('a static host serves index.html first');
    expect(prompt).not.toContain('expected');
    expect(prompt).toContain('folder / (root)');

    expect(buildPublishPrompt({ doc, target: { repo: null, branch: 'main', folder: 'docs' } })).toContain('--out docs');
  });
});
