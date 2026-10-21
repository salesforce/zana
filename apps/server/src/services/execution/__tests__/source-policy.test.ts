import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_LINK_HOPS,
  READABLE_DATA_DIRS,
  SENSITIVE_HOME_PATHS,
  SOURCE_POLICY_TEXT,
  displaySourcePath,
  allowedLocationsText,
  isSensitiveSourcePath,
  linkChainRefusal,
  resolveSourcePolicy,
  sourcePathRefusal,
  sourcePolicyText,
  sourceRefusal
} from '../source-policy.js';

const home = '/Users/me';
const policy = { roots: ['/work/proj', home, '/clones'], home };

describe('sourcePathRefusal', () => {
  it.each([
    ['a project file', '/work/proj/docs/plan.md'],
    ['a HOME file outside the project', '/Users/me/vault/design.md'],
    ['a clone root file', '/clones/other/plan.md'],
    ['Zana\'s library', '/Users/me/.zcc/library/designs/x.md'],
    ['Zana\'s personas', '/Users/me/.zcc/personas/p.json']
  ])('allows %s', (_name, path) => {
    expect(sourcePathRefusal(path, policy)).toBeUndefined();
  });

  it.each([
    ['/etc/hosts'],
    ['/work/other/plan.md'],
    ['/work/proj'],
    ['/Users/me']
  ])('refuses %s as outside every base', (path) => {
    expect(sourcePathRefusal(path, policy)).toBe('outside');
  });

  it.each([
    ['/Users/me/.ssh/id_rsa'],
    ['/Users/me/.aws/credentials'],
    ['/Users/me/.gnupg/secring.gpg'],
    ['/Users/me/.config/gh/hosts.yml'],
    ['/Users/me/.netrc'],
    ['/Users/me/.docker/config.json'],
    ['/Users/me/.zcc/auth.json'],
    ['/Users/me/.zcc/runtime.sqlite'],
    ['/Users/me/.zcc/plugins/salesforce/settings.json'],
    ['/Users/me/.zcc/mcp/servers.json'],
    ['/Users/me/.zcc/inbox/entries.json'],
    ['/Users/me/.zcc/a-state-folder-added-later/x.json'],
    ['/Users/me/.zcc-dev/host-enroll.token'],
    ['/Users/me/.zcc-machines/m1/auth.json'],
    ['/Users/me/.codex/auth.json'],
    ['/Users/me/.claude/sessions/s.jsonl'],
    ['/Users/me/.git-credentials'],
    ['/Users/me/.npmrc'],
    ['/Users/me/.pypirc'],
    ['/Users/me/.kube/config'],
    ['/Users/me/.claude.json'],
    ['/Users/me/.claude/.credentials.json'],
    ['/Users/me/.claude/projects/p/s.jsonl'],
    ['/Users/me/Library/Keychains/login.keychain-db'],
    ['/Users/me/.local/share/opencode/auth.json'],
    ['/Users/me/.pi/agent/auth.json'],
    ['/Users/me/.grok/sessions/s.json'],
    ['/Users/me/.gemini/oauth_creds.json'],
    ['/Users/me/.cc-center/control.token']
  ])('refuses %s as protected', (path) => {
    expect(sourcePathRefusal(path, policy)).toBe('sensitive');
  });

  it('decides case variants like the lower-case form (macOS volumes are case-insensitive)', () => {
    expect(sourcePathRefusal('/Users/me/.SSH/id', policy)).toBe('sensitive');
    expect(sourcePathRefusal('/Users/me/.Claude/Sessions/s', policy)).toBe('sensitive');
    expect(sourcePathRefusal('/Users/me/.ZCC/auth.json', policy)).toBe('sensitive');
    expect(sourcePathRefusal('/Users/me/.zcc/LIBRARY/x', policy)).toBeUndefined();
    expect(sourcePathRefusal('/Users/me/.zcc/library/x', policy)).toBeUndefined();
    expect(sourcePathRefusal('/Users/me/.zcc/LIBRARY/x', { ...policy, protectedRoots: ['/Users/me/.ssh'], dataDirs: ['/Users/me/.zcc'] })).toBeUndefined();
  });

  it('keeps the managed worktree folder readable', () => {
    expect(READABLE_DATA_DIRS).toContain('worktrees');
    expect(sourcePathRefusal('/Users/me/.zcc/worktrees/w/a.md', policy)).toBeUndefined();
  });

  it('keeps a Project cloned into a data folder readable (the host daemon\'s default clone path)', () => {
    expect(READABLE_DATA_DIRS).toContain('checkouts');
    expect(sourcePathRefusal('/Users/me/.zcc/checkouts/app/docs/plan.md', { ...policy, roots: ['/Users/me/.zcc/checkouts/app', home] })).toBeUndefined();
    expect(sourcePathRefusal('/Users/me/.zcc/auth.json', { ...policy, roots: ['/Users/me/.zcc/checkouts/app', home] })).toBe('sensitive');
  });

  it('protects a credential store even when the project sits in HOME', () => {
    expect(sourcePathRefusal('/Users/me/.ssh/config', { roots: [home], home })).toBe('sensitive');
  });

  it('protects every Zana data folder it is given, plus ~/.zcc', () => {
    const dev = { home, dataDirs: ['/Users/me/.zcc', '/Users/me/.zcc-dev'] };
    expect(isSensitiveSourcePath('/Users/me/.zcc-dev/host-enroll.token', dev)).toBe(true);
    expect(isSensitiveSourcePath('/Users/me/.zcc/control.token', dev)).toBe(true);
    expect(isSensitiveSourcePath('/Users/me/.zcc-dev/library/a.md', dev)).toBe(false);
  });

  it('protects extra roots it is given, such as the app\'s own data', () => {
    const appData = '/Users/me/Library/Application Support/Zana';
    expect(sourcePathRefusal(`${appData}/Partitions/zcc-browser/Cookies`, { ...policy, protectedRoots: [appData] })).toBe('sensitive');
  });

  it('names the protected locations and the readable folders for the agent', () => {
    for (const path of SENSITIVE_HOME_PATHS) expect(SOURCE_POLICY_TEXT).toContain(`~/${path}`);
    for (const name of READABLE_DATA_DIRS) expect(SOURCE_POLICY_TEXT).toContain(name);
  });
});

describe('resolveSourcePolicy', () => {
  it('realpaths the bases and drops the ones that do not resolve', async () => {
    const realHome = realpathSync(mkdtempSync(join(tmpdir(), 'zcc-policy-home-')));
    const project = realpathSync(mkdtempSync(join(tmpdir(), 'zcc-policy-project-')));
    const resolved = await resolveSourcePolicy(realpath, {
      projectRoot: project, home: realHome, cloneRoot: join(realHome, 'missing'), dataDirs: [join(realHome, '.zcc-dev'), join(realHome, 'gone')]
    });
    expect(resolved.roots).toEqual([project, realHome]);
    expect(resolved.home).toBe(realHome);
    expect(resolved.dataDirs).toEqual([join(realHome, '.zcc'), join(realHome, '.zcc-dev'), join(realHome, '.zcc-machines'), join(realHome, '.cc-center'), join(realHome, 'gone')]);
  });

  it('falls back to HOME as given, and ignores a blank clone root', async () => {
    const resolved = await resolveSourcePolicy(realpath, { home: '/no/such/home', cloneRoot: '  ' });
    expect(resolved.roots).toEqual(['/no/such/home']);
  });

  it('ignores a world-writable clone root and /Volumes, keeps a private one', async () => {
    const realHome = realpathSync(mkdtempSync(join(tmpdir(), 'zcc-policy-home-')));
    const clones = realpathSync(mkdtempSync(join(tmpdir(), 'zcc-policy-clones-')));
    const id = async (path: string) => path;
    const modes: Record<string, number> = { '/shared': 0o40777, '/Volumes': 0o40755, [clones]: 0o40700 };
    const stat = async (path: string) => ({ mode: modes[path] ?? 0o40755 });
    expect((await resolveSourcePolicy(id, { home: realHome, cloneRoot: '/shared', stat })).roots).toEqual([realHome]);
    expect((await resolveSourcePolicy(id, { home: realHome, cloneRoot: '/Volumes', stat })).roots).toEqual([realHome]);
    expect((await resolveSourcePolicy(id, { home: realHome, cloneRoot: clones, stat })).roots).toEqual([realHome, clones]);
    // The real /tmp resolves to a world-writable directory, with the default stat.
    expect((await resolveSourcePolicy(realpath, { home: realHome, cloneRoot: '/tmp' })).roots).toEqual([realHome]);
    // An unreadable mode is not trusted.
    const broken = async () => { throw new Error('EACCES'); };
    expect((await resolveSourcePolicy(id, { home: realHome, cloneRoot: clones, stat: broken })).roots).toEqual([realHome]);
  });

  it('refuses everything outside the Project when HOME resolves to /', async () => {
    const id = async (path: string) => path;
    const resolved = await resolveSourcePolicy(id, { projectRoot: '/work/proj', home: '/', cloneRoot: '/clones', stat: async () => ({ mode: 0o40700 }) });
    expect(resolved.roots).toEqual(['/work/proj']);
    expect(sourcePathRefusal('/etc/hosts', resolved)).toBe('outside');
    expect(sourcePathRefusal('/work/proj/a.md', resolved)).toBeUndefined();
  });

  it('keeps a symlinked credential store refused (a dotfiles setup)', async () => {
    const realHome = realpathSync(mkdtempSync(join(tmpdir(), 'zcc-policy-home-')));
    mkdirSync(join(realHome, 'dotfiles', 'ssh'), { recursive: true });
    writeFileSync(join(realHome, 'dotfiles', 'ssh', 'id_ed25519'), 'PRIVATE');
    symlinkSync(join(realHome, 'dotfiles', 'ssh'), join(realHome, '.ssh'));
    const resolved = await resolveSourcePolicy(realpath, { home: realHome });
    const real = await realpath(join(realHome, '.ssh', 'id_ed25519'));
    expect(real).toBe(join(realHome, 'dotfiles', 'ssh', 'id_ed25519'));
    expect(sourcePathRefusal(real, resolved)).toBe('sensitive');
  });

  it('drops a clone root that is a filesystem root or contains HOME', async () => {
    const realHome = realpathSync(mkdtempSync(join(tmpdir(), 'zcc-policy-home-')));
    const clones = realpathSync(mkdtempSync(join(tmpdir(), 'zcc-policy-clones-')));
    expect((await resolveSourcePolicy(realpath, { home: realHome, cloneRoot: '/' })).roots).toEqual([realHome]);
    expect((await resolveSourcePolicy(realpath, { home: realHome, cloneRoot: join(realHome, '..') })).roots).toEqual([realHome]);
    expect((await resolveSourcePolicy(realpath, { home: realHome, cloneRoot: clones })).roots).toEqual([realHome, clones]);
  });
});

describe('displaySourcePath', () => {
  it('abbreviates HOME and leaves other paths whole', () => {
    expect(displaySourcePath('/Users/me/vault/design.md', home)).toBe('~/vault/design.md');
    expect(displaySourcePath('/clones/x/plan.md', home)).toBe('/clones/x/plan.md');
  });
});

/** Fake links: a map from path to its target; every other path is an ordinary entry. */
const fakeLinks = (links: Record<string, string>) => ({
  lstat: async (path: string) => ({ isSymbolicLink: () => path in links }),
  readlink: async (path: string) => links[path]!
});

describe('linkChainRefusal', () => {
  const chainPolicy = { home, protectedRoots: ['/Users/me/.ssh'], dataDirs: ['/Users/me/.zcc'] };

  it('refuses a path given inside a protected folder, even for a per-file link that leaves it', async () => {
    const fs = fakeLinks({ '/Users/me/.ssh/id_rsa': '/Users/me/dotfiles/ssh/id_rsa' });
    expect(await linkChainRefusal('/Users/me/.ssh/id_rsa', chainPolicy, fs)).toBe('sensitive');
  });

  it('refuses a link from a normal file to a protected file, absolute or relative', async () => {
    expect(await linkChainRefusal('/Users/me/notes.md', chainPolicy, fakeLinks({ '/Users/me/notes.md': '/Users/me/.ssh/id_rsa' }))).toBe('sensitive');
    expect(await linkChainRefusal('/Users/me/notes.md', chainPolicy, fakeLinks({ '/Users/me/notes.md': '.ssh/id_rsa' }))).toBe('sensitive');
    expect(await linkChainRefusal('/Users/me/notes.md', chainPolicy, fakeLinks({ '/Users/me/notes.md': '../me/x/../.ssh/id_rsa' }))).toBe('sensitive');
  });

  it('refuses a chain of links that ends in a protected file, and a link through a linked folder', async () => {
    const fs = fakeLinks({ '/a/one': '/b/two', '/b/two': '/Users/me/.ssh/id_rsa', '/c/dir': '/Users/me/.ssh' });
    expect(await linkChainRefusal('/a/one', chainPolicy, fs)).toBe('sensitive');
    expect(await linkChainRefusal('/c/dir/id_rsa', chainPolicy, fs)).toBe('sensitive');
  });

  it('allows an ordinary link between allowed locations, a missing file, and a Zana readable folder', async () => {
    const fs = fakeLinks({ '/Users/me/vault/plan.md': '/work/proj/docs/plan.md' });
    expect(await linkChainRefusal('/Users/me/vault/plan.md', chainPolicy, fs)).toBeUndefined();
    expect(await linkChainRefusal('/Users/me/gone.md', chainPolicy, fakeLinks({}))).toBeUndefined();
    expect(await linkChainRefusal('/Users/me/.zcc/library/x.md', chainPolicy, fakeLinks({}))).toBeUndefined();
    expect(await linkChainRefusal('/Users/me/.zcc/auth.json', chainPolicy, fakeLinks({}))).toBe('sensitive');
    expect(await linkChainRefusal('relative/path', chainPolicy, fakeLinks({}))).toBeUndefined();
  });

  it('refuses a loop, too many hops, and a link that cannot be read, but allows exactly the maximum', async () => {
    expect(await linkChainRefusal('/a/loop', chainPolicy, fakeLinks({ '/a/loop': '/a/loop' }))).toBe('links');
    const chain: Record<string, string> = {};
    for (let i = 0; i <= MAX_LINK_HOPS; i += 1) chain[`/l/${i}`] = `/l/${i + 1}`;
    expect(await linkChainRefusal('/l/0', chainPolicy, fakeLinks(chain))).toBe('links');
    const ok: Record<string, string> = {};
    for (let i = 0; i < MAX_LINK_HOPS; i += 1) ok[`/l/${i}`] = `/l/${i + 1}`;
    expect(await linkChainRefusal('/l/0', chainPolicy, fakeLinks(ok))).toBeUndefined();
    const unreadable = { lstat: async () => ({ isSymbolicLink: () => true }), readlink: async () => { throw new Error('EACCES'); } };
    expect(await linkChainRefusal('/a/b', chainPolicy, unreadable)).toBe('links');
    // An lstat that fails (or has no link flag) is not a link.
    expect(await linkChainRefusal('/a/b', chainPolicy, { lstat: async () => { throw new Error('ENOENT'); }, readlink: async () => '/x' })).toBeUndefined();
    expect(await linkChainRefusal('/a/b', chainPolicy, { lstat: async () => ({}), readlink: async () => '/x' })).toBeUndefined();
  });

  it('follows real links on disk: a per-file link into a protected folder, and a link to a protected file', async () => {
    const realHome = realpathSync(mkdtempSync(join(tmpdir(), 'zcc-policy-chain-')));
    mkdirSync(join(realHome, '.ssh'));
    mkdirSync(join(realHome, 'dotfiles', 'ssh'), { recursive: true });
    mkdirSync(join(realHome, 'vault'));
    writeFileSync(join(realHome, 'dotfiles', 'ssh', 'id_rsa'), 'PRIVATE');
    symlinkSync(join(realHome, 'dotfiles', 'ssh', 'id_rsa'), join(realHome, '.ssh', 'id_rsa'));
    symlinkSync(join(realHome, '.ssh', 'id_rsa'), join(realHome, 'notes.md'));
    writeFileSync(join(realHome, 'vault', 'a.md'), 'ok');
    symlinkSync(join(realHome, 'vault', 'a.md'), join(realHome, 'b.md'));
    symlinkSync(join(realHome, 'loop2'), join(realHome, 'loop1'));
    symlinkSync(join(realHome, 'loop1'), join(realHome, 'loop2'));
    const resolved = await resolveSourcePolicy(realpath, { home: realHome });
    const check = async (given: string) => {
      let real: string | undefined;
      try { real = await realpath(given); } catch { /* a loop has no realpath */ }
      return real === undefined ? linkChainRefusal(given, resolved) : sourceRefusal(given, real, resolved);
    };
    // The final realpath of both is the unprotected dotfiles copy: only the walk refuses them.
    expect(sourcePathRefusal(await realpath(join(realHome, '.ssh', 'id_rsa')), resolved)).toBeUndefined();
    expect(await check(join(realHome, '.ssh', 'id_rsa'))).toBe('sensitive');
    expect(await check(join(realHome, 'notes.md'))).toBe('sensitive');
    expect(await check(join(realHome, 'b.md'))).toBeUndefined();
    expect(await check(join(realHome, 'loop1'))).toBe('links');
  });
});

describe('credential, history and browser-profile locations under HOME', () => {
  it.each([
    '.azure/accessTokens.json', '.config/op/config', '.terraform.d/credentials.tfrc.json', '.cargo/credentials', '.cargo/credentials.toml',
    '.m2/settings.xml', '.password-store/mail.gpg', '.local/share/keyrings/login.keyring',
    '.bash_history', '.zsh_history', '.zhistory', '.python_history', '.node_repl_history', '.psql_history', '.mysql_history', '.lesshst',
    'Library/Application Support/Google/Chrome/Default/Login Data', 'Library/Application Support/BraveSoftware/Brave-Browser/Default/Cookies',
    'Library/Application Support/Microsoft Edge/Default/History', 'Library/Application Support/Firefox/Profiles/x/logins.json',
    'Library/Safari/History.db', '.mozilla/firefox/x/key4.db', '.config/google-chrome/Default/Cookies', '.config/chromium/Default/Cookies',
    '.config/BraveSoftware/Brave-Browser/Default/Cookies',
    '.oci/config', '.vault-token', '.pgpass', '.my.cnf', '.sfdx/key.json', '.sf/config.json', '.gem/credentials', '.config/rclone/rclone.conf'
  ])('refuses ~/%s', (entry) => {
    expect(SENSITIVE_HOME_PATHS.some((path) => entry === path || entry.startsWith(`${path}/`)), entry).toBe(true);
    expect(sourcePathRefusal(`/Users/me/${entry}`, policy), entry).toBe('sensitive');
  });

  it('still allows the neighbours of those entries', () => {
    for (const entry of ['.cargo/config.toml', '.m2/pom.xml', '.config/nvim/init.lua', 'Library/Preferences/x.plist', '.bashrc', '.zshrc', 'Documents/notes.md']) {
      expect(sourcePathRefusal(`/Users/me/${entry}`, policy), entry).toBeUndefined();
    }
  });

  it('refuses them through a link too, and lists them in the text shown to the agent', async () => {
    const fs = fakeLinks({ '/Users/me/notes.md': '/Users/me/.zsh_history' });
    expect(await linkChainRefusal('/Users/me/notes.md', policy, fs)).toBe('sensitive');
    expect(SOURCE_POLICY_TEXT).toContain('~/.zsh_history');
    expect(SOURCE_POLICY_TEXT).toContain('~/Library/Application Support/Google/Chrome');
  });
});

describe('sourceRefusal', () => {
  it('runs the link walk, then the realpath policy', async () => {
    const fs = fakeLinks({ '/Users/me/notes.md': '/Users/me/.ssh/id_rsa' });
    expect(await sourceRefusal('/Users/me/notes.md', '/Users/me/dotfiles/id_rsa', policy, fs)).toBe('sensitive');
    expect(await sourceRefusal('/Users/me/ok.md', '/etc/hosts', policy, fakeLinks({}))).toBe('outside');
    expect(await sourceRefusal('/Users/me/ok.md', '/Users/me/ok.md', policy, fakeLinks({}))).toBeUndefined();
    expect(await sourceRefusal('/a/loop', '/Users/me/ok.md', policy, fakeLinks({ '/a/loop': '/a/loop' }))).toBe('links');
  });
});

describe('inside the registered Project', () => {
  const id = async (path: string) => path;
  const base = { home: '/Users/me', protectedRoots: ['/Users/me/Library/Application Support/Zana'] };

  it('keeps only the protections that predate the shared policy, and applies the newer ones outside the Project', async () => {
    const resolved = await resolveSourcePolicy(id, { ...base, projectRoot: '/Users/me/.claude/projects/p' });
    // Newer credential entries: allowed inside the Project, refused outside it.
    expect(sourcePathRefusal('/Users/me/.claude/projects/p/memory/MEMORY.md', resolved)).toBeUndefined();
    expect(sourcePathRefusal('/Users/me/.claude/projects/other/s.jsonl', resolved)).toBe('sensitive');
    expect(sourcePathRefusal('/Users/me/.codex/auth.json', resolved)).toBe('sensitive');
    // The original ones: refused everywhere, including inside the Project.
    expect(sourcePathRefusal('/Users/me/.ssh/id_rsa', resolved)).toBe('sensitive');
    expect(sourcePathRefusal('/Users/me/.zcc/auth.json', resolved)).toBe('sensitive');
    const codexProject = await resolveSourcePolicy(id, { ...base, projectRoot: '/Users/me/.codex/work' });
    expect(sourcePathRefusal('/Users/me/.codex/work/notes.md', codexProject)).toBeUndefined();
    expect(sourcePathRefusal('/Users/me/.codex/auth.json', codexProject)).toBe('sensitive');
    const sshProject = await resolveSourcePolicy(id, { ...base, projectRoot: '/Users/me/.ssh/proj' });
    expect(sourcePathRefusal('/Users/me/.ssh/proj/a.md', sshProject)).toBe('sensitive');
    const appData = await resolveSourcePolicy(id, { ...base, projectRoot: '/Users/me/Library/Application Support/Zana/proj' });
    expect(sourcePathRefusal('/Users/me/Library/Application Support/Zana/proj/a.md', appData)).toBe('sensitive');
    const dataProject = await resolveSourcePolicy(id, { ...base, projectRoot: '/Users/me/.zcc/checkouts/app' });
    expect(sourcePathRefusal('/Users/me/.zcc/checkouts/app/a.md', dataProject)).toBeUndefined();
    expect(sourcePathRefusal('/Users/me/.zcc/auth.json', dataProject)).toBe('sensitive');
  });

  it('keeps Claude Code\'s credentials file refused for a Project inside ~/.claude', async () => {
    const resolved = await resolveSourcePolicy(id, { ...base, projectRoot: '/Users/me/.claude' });
    expect(sourcePathRefusal('/Users/me/.claude/.credentials.json', resolved)).toBe('sensitive');
    // ~/.claude/projects lies inside this Project, so it stays refused; only roots holding the Project are dropped.
    expect(sourcePathRefusal('/Users/me/.claude/projects/p/memory/MEMORY.md', resolved)).toBe('sensitive');
    expect(sourcePathRefusal('/Users/me/.claude/sessions/s.jsonl', resolved)).toBe('sensitive');
    expect(sourcePathRefusal('/Users/me/.claude/settings.json', resolved)).toBeUndefined();
  });

  it('drops only the protected roots that hold the Project: a protected root inside the Project stays refused', async () => {
    const config = await resolveSourcePolicy(id, { ...base, projectRoot: '/Users/me/.config' });
    expect(sourcePathRefusal('/Users/me/.config/gh/hosts.yml', config)).toBe('sensitive');
    expect(sourcePathRefusal('/Users/me/.config/gcloud/credentials.db', config)).toBe('sensitive');
    expect(sourcePathRefusal('/Users/me/.config/op/config', config)).toBe('sensitive');
    expect(sourcePathRefusal('/Users/me/.config/nvim/init.lua', config)).toBeUndefined();
    const library = await resolveSourcePolicy(id, { ...base, projectRoot: '/Users/me/Library' });
    expect(sourcePathRefusal('/Users/me/Library/Keychains/login.keychain-db', library)).toBe('sensitive');
    expect(sourcePathRefusal('/Users/me/Library/Application Support/Google/Chrome/Default/Cookies', library)).toBe('sensitive');
    expect(sourcePathRefusal('/Users/me/Library/Preferences/x.plist', library)).toBeUndefined();
    const docker = await resolveSourcePolicy(id, { ...base, projectRoot: '/Users/me/.docker' });
    expect(sourcePathRefusal('/Users/me/.docker/config.json', docker)).toBe('sensitive');
    expect(sourcePathRefusal('/Users/me/.docker/compose.yml', docker)).toBeUndefined();
    // A Project inside a protected root still reaches its own files, and a sibling protected root is still refused.
    const chrome = await resolveSourcePolicy(id, { ...base, projectRoot: '/Users/me/.mozilla/work' });
    expect(sourcePathRefusal('/Users/me/.mozilla/work/a.md', chrome)).toBeUndefined();
    expect(sourcePathRefusal('/Users/me/.kube/config', chrome)).toBe('sensitive');
  });

  it('walks links with the same rule for a Project at ~/.config', async () => {
    const resolved = await resolveSourcePolicy(id, { ...base, projectRoot: '/Users/me/.config' });
    const fs = fakeLinks({ '/Users/me/.config/notes.md': '/Users/me/.config/gh/hosts.yml', '/Users/me/.config/ok.md': '/Users/me/.config/nvim/init.lua' });
    expect(await linkChainRefusal('/Users/me/.config/notes.md', resolved, fs)).toBe('sensitive');
    expect(await linkChainRefusal('/Users/me/.config/ok.md', resolved, fs)).toBeUndefined();
    expect(await linkChainRefusal('/Users/me/.config/nvim/init.lua', resolved, fs)).toBeUndefined();
    expect(await linkChainRefusal('/Users/me/.config/gh/hosts.yml', resolved, fs)).toBe('sensitive');
  });

  it('applies the link walk with the same split', async () => {
    const resolved = await resolveSourcePolicy(id, { ...base, projectRoot: '/Users/me/.claude/projects/p' });
    const fs = fakeLinks({ '/Users/me/.claude/projects/p/a.md': '/Users/me/.claude/projects/p/memory/m.md', '/Users/me/b.md': '/Users/me/.claude/projects/other/s.jsonl' });
    expect(await linkChainRefusal('/Users/me/.claude/projects/p/a.md', resolved, fs)).toBeUndefined();
    expect(await linkChainRefusal('/Users/me/b.md', resolved, fs)).toBe('sensitive');
  });

  it('does not relax anything when the Project is HOME or holds it', async () => {
    const homeProject = await resolveSourcePolicy(id, { ...base, projectRoot: '/Users/me' });
    expect(sourcePathRefusal('/Users/me/.codex/auth.json', homeProject)).toBe('sensitive');
    const parentProject = await resolveSourcePolicy(id, { ...base, projectRoot: '/Users' });
    expect(sourcePathRefusal('/Users/me/.claude/projects/p/s.jsonl', parentProject)).toBe('sensitive');
    const rootHome = await resolveSourcePolicy(id, { home: '/', projectRoot: '/work/proj' });
    expect(rootHome.projectRoot).toBeUndefined();
  });
});

describe('clone root and platform', () => {
  const id = async (path: string) => path;
  const worldWritable = async () => ({ mode: 0o40777 });

  it('skips the world-writable check on win32, where libuv reports 0o666 for every directory', async () => {
    const win = await resolveSourcePolicy(id, { home: '/Users/me', cloneRoot: '/clones', stat: worldWritable, platform: 'win32' });
    expect(win.roots).toEqual(['/Users/me', '/clones']);
    expect(win.cloneRoot).toBe('/clones');
    for (const platform of ['darwin', 'linux'] as const) {
      expect((await resolveSourcePolicy(id, { home: '/Users/me', cloneRoot: '/clones', stat: worldWritable, platform })).roots).toEqual(['/Users/me']);
    }
    // Other protections still apply on win32.
    expect((await resolveSourcePolicy(id, { home: '/Users/me', cloneRoot: '/Users', stat: worldWritable, platform: 'win32' })).roots).toEqual(['/Users/me']);
  });

  it('defaults to the running platform', async () => {
    const resolved = await resolveSourcePolicy(id, { home: '/Users/me', cloneRoot: '/clones', stat: worldWritable });
    expect(resolved.roots).toEqual(process.platform === 'win32' ? ['/Users/me', '/clones'] : ['/Users/me']);
  });

  it('names only the locations that are active in a refusal', async () => {
    const withClone = await resolveSourcePolicy(id, { projectRoot: '/work/proj', home: '/Users/me', cloneRoot: '/clones', stat: async () => ({ mode: 0o40700 }), platform: 'linux' });
    const dropped = await resolveSourcePolicy(id, { projectRoot: '/work/proj', home: '/Users/me', cloneRoot: '/tmp', stat: worldWritable, platform: 'linux' });
    const unset = await resolveSourcePolicy(id, { projectRoot: '/work/proj', home: '/Users/me' });
    const rootHome = await resolveSourcePolicy(id, { projectRoot: '/work/proj', home: '/', cloneRoot: '/clones', stat: async () => ({ mode: 0o40700 }) });
    expect(allowedLocationsText(withClone)).toBe('the project, your home folder and the clone root');
    expect(allowedLocationsText(dropped)).toBe('the project and your home folder');
    expect(allowedLocationsText(unset)).toBe('the project and your home folder');
    expect(allowedLocationsText(rootHome)).toBe('the project');
    expect(sourcePolicyText(dropped)).toContain('inside this project and your home folder.');
    expect(sourcePolicyText(dropped)).not.toContain('clone root');
    expect(sourcePolicyText(withClone)).toContain('this project, your home folder and the clone root');
    expect(SOURCE_POLICY_TEXT).toContain('the clone root');
    expect(SOURCE_POLICY_TEXT).toContain('~/.ssh, ~/.aws, ~/.claude/.credentials.json');
  });
});
