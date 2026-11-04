import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAst } from 'vite';
import { describe, expect, it } from 'vitest';

// Zana's server, host daemon and plugins run under Electron, a GUI process. On
// Windows a console child spawned from there without `windowsHide: true` opens a
// visible console window (#635, #656). Every child_process call in shipped code
// either passes `windowsHide: true` in an options object literal or is named here
// with the reason it can't open one. A new call fails this test until someone
// decides which it is.

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..', '..', '..', '..');
const ROOTS = ['apps/server/src', 'apps/host-daemon/src', 'apps/desktop/src', 'packages', 'plugins'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'build', 'coverage', '__tests__', '__fixtures__', 'test', 'tests', 'testing', 'scripts']);

/**
 * `file` is relative to the repo root with forward slashes. `count` is how many
 * calls without `windowsHide: true` that file may keep. The reason is the review record.
 */
const ALLOW_LIST: readonly { file: string; count: number; reason: string }[] = [
  { file: 'apps/desktop/src/browser-import/chromium-keys.ts', count: 1, reason: 'runs macOS security / Linux secret-tool only' },
  { file: 'apps/desktop/src/browser-import/mac-app-icon.ts', count: 1, reason: 'macOS-only app icon extraction' },
  { file: 'apps/desktop/src/browser-import/sources.ts', count: 2, reason: 'ps and lsof probes for macOS and Linux browser sources' },
  {
    file: 'apps/desktop/src/native/openers.ts',
    count: 2,
    reason: 'macOS /usr/bin/open, and spawnDetached: GUI editor exes on Windows have no console to hide, and windowsHide also passes SW_HIDE, which can hide the editor window itself'
  },
  { file: 'apps/host-daemon/src/env.ts', count: 1, reason: 'login-shell PATH probe returns early on win32' },
  {
    file: 'apps/host-daemon/src/join-cli.ts',
    count: 1,
    reason: 'standalone host self-restart, detached: on Windows DETACHED_PROCESS gives the child no console, and windowsHide is ignored with it'
  },
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

const CHILD_PROCESS_NAMES = new Set(['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork']);
const CHILD_PROCESS_MODULES = new Set(['child_process', 'node:child_process']);

// A minimal ESTree view: enough to walk the tree and read the nodes used below.
interface Node {
  type: string;
  start: number;
  [key: string]: unknown;
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && typeof (value as Node).type === 'string';
}

function visit(node: Node, enter: (node: Node) => void): void {
  enter(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) visit(item, enter);
    } else if (isNode(value)) {
      visit(value, enter);
    }
  }
}

function keyName(node: unknown): string | undefined {
  if (!isNode(node)) return undefined;
  if (node.type === 'Identifier') return node.name as string;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  return undefined;
}

function stringLiteral(node: unknown): string | undefined {
  return isNode(node) && node.type === 'Literal' && typeof node.value === 'string' ? node.value : undefined;
}

/** The module a `require('x')`, `import('x')` or `await import('x')` expression loads. */
function loadedModule(node: unknown): string | undefined {
  if (!isNode(node)) return undefined;
  if (node.type === 'AwaitExpression') return loadedModule(node.argument);
  if (node.type === 'ImportExpression') return stringLiteral(node.source);
  if (node.type === 'CallExpression' && keyName(node.callee) === 'require') {
    return stringLiteral((node.arguments as unknown[])[0]);
  }
  return undefined;
}

/** `true` itself, or the minified `!0`. */
function isTrue(node: unknown): boolean {
  if (!isNode(node)) return false;
  if (node.type === 'Literal') return node.value === true;
  return node.type === 'UnaryExpression' && node.operator === '!' && isNode(node.argument) &&
    node.argument.type === 'Literal' && node.argument.value === 0;
}

/** An options object literal passed straight to the call that sets `windowsHide: true`. */
function hidesWindow(call: Node): boolean {
  return (call.arguments as Node[]).some((arg) => arg.type === 'ObjectExpression' &&
    (arg.properties as Node[]).some((prop) =>
      prop.type === 'Property' && !prop.computed && keyName(prop.key) === 'windowsHide' && isTrue(prop.value)));
}

interface Bindings {
  /** Local names bound to a child_process (or cross-spawn) function. */
  functions: Set<string>;
  /** Local names bound to the child_process module itself. */
  modules: Set<string>;
}

function bindModuleNames(pattern: Node, bindings: Bindings): void {
  if (pattern.type === 'Identifier') {
    bindings.modules.add(pattern.name as string);
    return;
  }
  if (pattern.type !== 'ObjectPattern') return;
  for (const prop of pattern.properties as Node[]) {
    const imported = prop.type === 'Property' ? keyName(prop.key) : undefined;
    const local = prop.type === 'Property' && isNode(prop.value) ? keyName(prop.value) : undefined;
    if (imported && local && CHILD_PROCESS_NAMES.has(imported)) bindings.functions.add(local);
  }
}

function collectImport(node: Node, bindings: Bindings): void {
  const source = stringLiteral(node.source);
  if (source === 'cross-spawn') {
    for (const spec of node.specifiers as Node[]) bindings.functions.add(keyName(spec.local)!);
    return;
  }
  if (!source || !CHILD_PROCESS_MODULES.has(source)) return;
  for (const spec of node.specifiers as Node[]) {
    const local = keyName(spec.local)!;
    if (spec.type === 'ImportSpecifier') {
      if (CHILD_PROCESS_NAMES.has(keyName(spec.imported) ?? '')) bindings.functions.add(local);
    } else {
      bindings.modules.add(local);
    }
  }
}

/** Whether an expression is one of the bound child_process functions (`spawn`, `cp.spawn`). */
function isChildProcessFunction(node: unknown, bindings: Bindings): boolean {
  if (!isNode(node)) return false;
  if (node.type === 'Identifier') return bindings.functions.has(node.name as string);
  return node.type === 'MemberExpression' && !node.computed && isNode(node.object) &&
    node.object.type === 'Identifier' && bindings.modules.has(node.object.name as string) &&
    CHILD_PROCESS_NAMES.has(keyName(node.property) ?? '');
}

function collectDeclarator(node: Node, bindings: Bindings): void {
  if (!isNode(node.id) || !isNode(node.init)) return;
  const source = loadedModule(node.init);
  if (source && CHILD_PROCESS_MODULES.has(source)) {
    bindModuleNames(node.id, bindings);
  } else if (source === 'cross-spawn' && node.id.type === 'Identifier') {
    bindings.functions.add(node.id.name as string);
  } else if (node.id.type === 'Identifier' && node.init.type === 'CallExpression') {
    // promisify(execFile) / util.promisify(cp.execFile)
    const callee = node.init.callee as Node;
    const name = callee.type === 'MemberExpression' ? keyName(callee.property) : keyName(callee);
    if (name === 'promisify' && isChildProcessFunction((node.init.arguments as unknown[])[0], bindings)) {
      bindings.functions.add(node.id.name as string);
    }
  }
}

function parse(text: string, file: string): Node {
  const lang = /\.tsx$/.test(file) ? 'tsx' : /\.m?ts$/.test(file) ? 'ts' : 'js';
  return parseAst(text, { lang }) as unknown as Node;
}

/** Character offsets of child_process calls that don't pass `windowsHide: true`. */
export function unhiddenCalls(text: string, file = 'source.ts'): number[] {
  const ast = parse(text, file);
  const bindings: Bindings = { functions: new Set(), modules: new Set() };
  // Bindings come first (in source order, so promisify sees its target), calls second.
  visit(ast, (node) => {
    if (node.type === 'ImportDeclaration') collectImport(node, bindings);
    else if (node.type === 'VariableDeclarator') collectDeclarator(node, bindings);
  });
  const offsets: number[] = [];
  visit(ast, (node) => {
    if (node.type === 'CallExpression' && isChildProcessFunction(node.callee, bindings) && !hidesWindow(node)) {
      offsets.push(node.start);
    }
  });
  return offsets;
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(name) && !name.startsWith('.')) walk(full, out);
    } else if (/\.(ts|tsx|mts|mjs)$/.test(name) && !/\.(test|spec)\.|\.d\.m?ts$/.test(name)) {
      out.push(full);
    }
  }
}

function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split('\n').length;
}

let scanned: Map<string, number[]> | undefined;

/** Unhidden call lines per file. A file that doesn't parse fails the test instead of being skipped. */
function scan(): Map<string, number[]> {
  if (scanned) return scanned;
  const files: string[] = [];
  for (const root of ROOTS) walk(join(REPO, root), files);
  const found = new Map<string, number[]>();
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    let offsets: number[];
    try {
      offsets = unhiddenCalls(text, file);
    } catch (error) {
      throw new Error(`${relative(REPO, file)} did not parse: ${(error as Error).message}`);
    }
    const lines = offsets.map((offset) => lineOf(text, offset));
    if (lines.length > 0) found.set(relative(REPO, file).split(sep).join('/'), lines);
  }
  scanned = found;
  return found;
}

describe('child_process windowsHide guard', () => {
  it('every child_process call passes windowsHide: true or is on the allow-list with its reason', () => {
    const allowed = new Map(ALLOW_LIST.map((e) => [e.file, e.count]));
    const unlisted = [...scan()]
      .filter(([file, lines]) => lines.length > (allowed.get(file) ?? 0))
      .map(([file, lines]) => `${file}:${lines.join(',')} without windowsHide: true`);
    expect(unlisted).toEqual([]);
  });

  it('the allow-list has no stale entries', () => {
    const found = scan();
    const stale = ALLOW_LIST.filter((entry) => (found.get(entry.file)?.length ?? 0) !== entry.count).map((entry) => entry.file);
    expect(stale).toEqual([]);
  });

  it('every allow-list entry gives a reason', () => {
    for (const entry of ALLOW_LIST) expect(entry.reason.trim().length).toBeGreaterThan(10);
  });
});

describe('child_process windowsHide counter', () => {
  const count = (source: string, file?: string) => unhiddenCalls(source, file).length;
  const named = "import { spawn } from 'node:child_process';\n";

  it('accepts windowsHide: true in an options literal, including spread and minified forms', () => {
    expect(count(`${named}spawn('git', [], { windowsHide: true });`)).toBe(0);
    expect(count(`${named}spawn('git', [], { ...base, stdio: 'ignore', windowsHide: true });`)).toBe(0);
    expect(count(`${named}spawn('git', [], { windowsHide: !0 });`, 'bundle.mjs')).toBe(0);
  });

  it('rejects false, non-literal, string and callback mentions of windowsHide', () => {
    expect(count(`${named}spawn('git', [], { windowsHide: false });`)).toBe(1);
    expect(count(`${named}spawn('git', [], { windowsHide: hide });`)).toBe(1);
    expect(count(`${named}spawn('git', ['windowsHide: true'], {});`)).toBe(1);
    expect(count(`${named}spawn('git', [], options);`)).toBe(1);
    expect(count("import { execFile } from 'node:child_process';\nexecFile('gh', [], {}, () => ({ windowsHide: true }));")).toBe(1);
  });

  it('sees named, aliased, default, namespace, required, dynamic, promisified and cross-spawn bindings', () => {
    expect(count("import { execFile as run } from 'node:child_process'; run('gh', [], {}, cb);")).toBe(1);
    expect(count("import cp from 'child_process'; cp.spawn('x', []);")).toBe(1);
    expect(count("import * as cp from 'node:child_process'; cp.execFileSync('x', []);")).toBe(1);
    expect(count("const cp = require('node:child_process'); cp.spawn('x');", 'a.mjs')).toBe(1);
    expect(count("const { spawn: s } = require('node:child_process'); s('x', [], {});", 'a.mjs')).toBe(1);
    expect(count("const cp = await import('node:child_process'); cp.fork('x');")).toBe(1);
    expect(count("import { execFile } from 'node:child_process'; const p = promisify(execFile); await p('tar', []);")).toBe(1);
    expect(count("import * as cp from 'node:child_process'; const p = util.promisify(cp.execFile); await p('tar', []);")).toBe(1);
    expect(count("import crossSpawn from 'cross-spawn'; crossSpawn('npm', []);")).toBe(1);
  });

  it('is not fooled by comment markers in strings, comments, or unrelated spawn functions', () => {
    expect(count(`${named}const glob = 'dir/*';\nspawn('x', []);\nconst end = '*/';`)).toBe(1);
    expect(count(`${named}// spawn('x')\n/* spawn('y') */\nobj.spawn('z');`)).toBe(0);
    expect(count("const spawn = (a: string) => a; spawn('not child_process');")).toBe(0);
    expect(count("import * as cp from 'node:child_process'; cp.other('x'); cp['spawn']('y');")).toBe(0);
  });
});
