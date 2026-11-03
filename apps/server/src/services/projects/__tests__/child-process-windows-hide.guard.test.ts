import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Zana's server, host daemon and plugins run under Electron, a GUI process. On
// Windows a console child spawned from there without `windowsHide: true` opens a
// visible console window (#635, #656). Every child_process call in shipped code
// either passes the option or is named here with the reason it can't open one.
// A new call fails this test until someone decides which it is.

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..', '..', '..', '..');
const ROOTS = ['apps/server/src', 'apps/host-daemon/src', 'apps/desktop/src', 'packages', 'plugins'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'build', 'coverage', '__tests__', '__fixtures__', 'test', 'tests', 'testing', 'scripts']);

/**
 * `file` is relative to the repo root with forward slashes. `count` is how many
 * calls without `windowsHide` that file may keep. The reason is the review record.
 */
const ALLOW_LIST: readonly { file: string; count: number; reason: string }[] = [
  { file: 'apps/desktop/src/browser-import/chromium-keys.ts', count: 1, reason: 'runs macOS security / Linux secret-tool only' },
  { file: 'apps/desktop/src/browser-import/mac-app-icon.ts', count: 1, reason: 'macOS-only app icon extraction' },
  { file: 'apps/desktop/src/browser-import/sources.ts', count: 2, reason: 'ps and lsof probes for macOS and Linux browser sources' },
  { file: 'apps/desktop/src/native/openers.ts', count: 2, reason: 'detached GUI editor launch, and /usr/bin/open on macOS' },
  { file: 'apps/host-daemon/src/env.ts', count: 1, reason: 'login-shell PATH probe returns early on win32' },
  { file: 'apps/host-daemon/src/join-cli.ts', count: 1, reason: 'inherits stdio: a standalone host restarting itself in its own console' },
  { file: 'apps/host-daemon/src/lock.ts', count: 1, reason: 'ps probe returns early on win32' },
  { file: 'apps/host-daemon/src/tmux.ts', count: 3, reason: 'tmux calls return early on win32' },
  { file: 'apps/server/src/services/peers/peer-ssh-local.ts', count: 2, reason: 'macOS scutil and /usr/bin/ssh for peer Remote Login' },
  { file: 'apps/server/src/services/peers/peer-sshd.ts', count: 3, reason: 'POSIX /usr/sbin/sshd and /bin/ps for peer pairing' },
  { file: 'packages/cli/src/lib/plugin-commands.ts', count: 1, reason: 'zcc CLI runs in the user terminal, which owns the console' },
  { file: 'packages/control-sdk/src/isolated.ts', count: 1, reason: 'developer harness that inherits the terminal stdio' },
  { file: 'apps/host-daemon/src/pty-pipe-shim.ts', count: 1, reason: 'pipe pty for the remote Linux join artifact, never loaded on Windows' },
  { file: 'packages/provider-bridge-acp/src/bridge/fake-acp-agent.mjs', count: 1, reason: 'test fixture agent, not shipped in the app' },
  { file: 'plugins/keep-awake/host.mjs', count: 1, reason: 'macOS caffeinate only' },
  { file: 'plugins/provider-acp/src/bridge/cursor-maintenance.ts', count: 1, reason: 'macOS security keychain lookup, returns early elsewhere' },
  { file: 'packages/provider-bridge-acp/src/bridge/provider-maintenance.ts', count: 1, reason: 'macOS security keychain lookup, returns early elsewhere' },
  { file: 'plugins/provider-claude-code/src/bridge/provider-maintenance.ts', count: 1, reason: 'macOS security keychain lookup, returns early elsewhere' },
];

const CHILD_PROCESS_NAMES = ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork'];

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(name) && !name.startsWith('.')) walk(full, out);
    } else if (/\.(ts|tsx|mts|mjs)$/.test(name) && !/\.(test|spec)\.|\.d\.ts$|\.mjs\.map$/.test(name)) {
      out.push(full);
    }
  }
}

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, '$1');
}

/** Local names bound to child_process / cross-spawn functions, including promisified ones. */
function spawnNames(source: string): Set<string> {
  const names = new Set<string>();
  const module = String.raw`['"](?:node:)?child_process['"]`;
  for (const m of source.matchAll(new RegExp(String.raw`import\s*\{([^}]*)\}\s*from\s*${module}`, 'g'))) bind(m[1]!);
  for (const m of source.matchAll(new RegExp(String.raw`const\s*\{([^}]*)\}\s*=\s*require\(\s*${module}\s*\)`, 'g'))) bind(m[1]!);
  for (const m of source.matchAll(/import\s+(\w+)\s+from\s*['"]cross-spawn['"]/g)) names.add(m[1]!);
  for (const m of source.matchAll(/(?:const|let)\s+(\w+)\s*=\s*promisify\(\s*(\w+)\s*\)/g)) if (names.has(m[2]!)) names.add(m[1]!);
  return names;

  function bind(list: string) {
    for (const part of list.split(',')) {
      const [imported, local] = part.replace(/\btype\s+/, '').trim().split(/\s+as\s+|\s*:\s*/).map((s) => s.trim());
      if (imported && CHILD_PROCESS_NAMES.includes(imported)) names.add(local || imported);
    }
  }
}

/** Calls to child_process functions whose argument list doesn't mention windowsHide. */
export function unhiddenCallCount(text: string): number {
  const source = stripComments(text);
  const names = spawnNames(source);
  if (names.size === 0) return 0;
  const call = new RegExp(String.raw`(?<![\w$.])(${[...names].join('|')})\s*\(`, 'g');
  let count = 0;
  for (const match of source.matchAll(call)) {
    if (/function\s*$/.test(source.slice(Math.max(0, match.index - 12), match.index))) continue;
    const start = match.index + match[0].length;
    let depth = 1;
    let end = start;
    while (end < source.length && depth > 0) {
      if (source[end] === '(') depth += 1;
      else if (source[end] === ')') depth -= 1;
      end += 1;
    }
    if (!/\bwindowsHide\b/.test(source.slice(start, end))) count += 1;
  }
  return count;
}

function scan(): Map<string, number> {
  const files: string[] = [];
  for (const root of ROOTS) walk(join(REPO, root), files);
  const found = new Map<string, number>();
  for (const file of files) {
    const count = unhiddenCallCount(readFileSync(file, 'utf8'));
    if (count > 0) found.set(relative(REPO, file).split(sep).join('/'), count);
  }
  return found;
}

describe('child_process windowsHide guard', () => {
  it('every child_process call passes windowsHide or is on the allow-list with its reason', () => {
    const allowed = new Map(ALLOW_LIST.map((e) => [e.file, e.count]));
    const unlisted = [...scan()]
      .filter(([file, count]) => count > (allowed.get(file) ?? 0))
      .map(([file, count]) => `${file}: ${count} call(s) without windowsHide`);
    expect(unlisted).toEqual([]);
  });

  it('the allow-list has no stale entries', () => {
    const found = scan();
    const stale = ALLOW_LIST.filter((entry) => (found.get(entry.file) ?? 0) !== entry.count).map((entry) => entry.file);
    expect(stale).toEqual([]);
  });

  it('every allow-list entry gives a reason', () => {
    for (const entry of ALLOW_LIST) expect(entry.reason.trim().length).toBeGreaterThan(10);
  });

  it('the counter sees direct, aliased, required, promisified and cross-spawn calls', () => {
    const hide = "import { spawn } from 'node:child_process'; spawn('git', [], { windowsHide: true });";
    expect(unhiddenCallCount(hide)).toBe(0);
    expect(unhiddenCallCount("import { spawn } from 'node:child_process'; spawn('git', ['x'], { stdio: f(a) });")).toBe(1);
    expect(unhiddenCallCount("import { execFile as run } from 'node:child_process'; run('gh', [], {}, cb);")).toBe(1);
    expect(unhiddenCallCount("const { spawn } = require('node:child_process'); spawn('x', [], {});")).toBe(1);
    expect(unhiddenCallCount("import { execFile } from 'node:child_process'; const p = promisify(execFile); await p('tar', []);")).toBe(1);
    expect(unhiddenCallCount("import crossSpawn from 'cross-spawn'; crossSpawn('npm', []);")).toBe(1);
    expect(unhiddenCallCount("import { spawn } from 'node:child_process'; // spawn('x')\nobj.spawn('y');")).toBe(0);
    expect(unhiddenCallCount("const spawn = (a) => a; spawn('not child_process');")).toBe(0);
  });
});
