/**
 * Package-manager `.cmd` shims on Windows (npm `cmd-shim`, and pnpm/yarn's
 * `@zkochan/cmd-shim`).
 *
 * `npm install -g @openai/codex` writes `codex.cmd`, a multi-line batch file
 * that runs `node.exe <script> %*`. Run as is, a CLI Agent's argv goes through
 * cmd.exe and its 8191-character cap. {@link parsePackageManagerShim} matches
 * the generators' exact templates (anything else returns null and the shim
 * runs as before), and {@link packageManagerShimLaunch} resolves the program
 * the way the shim does, so the host can spawn it without a shell.
 *
 * Templates, by generator:
 * - npm `cmd-shim` 4–8 (npm 7+) and 3 (npm 6): `%dp0%` from a `:find_dp0`
 *   subroutine, `IF EXIST "%dp0%\node.exe"`, else `node` from PATH.
 * - `@zkochan/cmd-shim` 5–7 (pnpm): `@SETLOCAL`, an optional `NODE_PATH` block,
 *   then `@IF EXIST "%~dp0\node.exe"`, else `node`; or a fixed node path
 *   (`nodeExecPath`).
 * - `@zkochan/cmd-shim` 3 (yarn 1): the `@IF EXIST` form without the leading
 *   `@SETLOCAL`.
 * Each also has a form without a program, for a target that is itself an exe.
 *
 * Not matched, so they keep the cmd.exe launch: a program other than node
 * (`/bin/sh`, `python`), shebang environment variables, `progArgs`,
 * `prependToPath`, an absolute target path, and any `%` or `!` in a path.
 */

import { statSync } from 'node:fs';
import { isAbsolute, join, normalize } from 'node:path';

export function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** A shim whose target is itself an executable. */
export interface ExeShim {
  kind: 'exe';
  command: string;
}

/** A shim that runs `node [nodeArgs] <script> %*`. */
export interface NodeShim {
  kind: 'node';
  script: string;
  /** Literal node arguments from the script's shebang (`#!/usr/bin/env node --flag`). */
  nodeArgs: string[];
  /** Fixed node from a pnpm `nodeExecPath` shim; otherwise node is looked up as the shim does. */
  node?: string;
  /** The `node.exe` next to the shim, which the shim prefers when it exists. */
  localNode?: string;
  /** Entries the shim prepends to `NODE_PATH`. */
  nodePath?: string;
}

export type PackageManagerShim = ExeShim | NodeShim;

export interface PackageManagerLaunch {
  command: string;
  args: string[];
  /** Environment changes the shim makes for the program (only `NODE_PATH`). */
  env?: Record<string, string>;
}

type Line = string | RegExp;

// A quoted path relative to the shim folder, with no `%`, `!` or quote inside.
const NPM_TARGET = String.raw`"(?<target>%dp0%\\[^"%!]+)"`;
const ZK_TARGET = String.raw`"(?<target>%~dp0\\[^"%!]+)"`;
// Shebang arguments: bare tokens without cmd syntax, one space apart. The
// generators write `<prog> <args> <target>`, so no arguments leave two spaces.
const ARGS = String.raw`(?<args>[^\s"%!^&|<>()]+(?: [^\s"%!^&|<>()]+)*)?`;
const NODE_PATH = String.raw`[^"%!]+`;

const exact = (pattern: string) => new RegExp(`^${pattern}$`);

const NPM_HEAD = ['@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start', 'SETLOCAL', 'CALL :find_dp0'];
const NPM_V3_HEAD = ['@ECHO off', 'SETLOCAL', 'CALL :find_dp0'];
const NPM_V3_TAIL = ['ENDLOCAL', 'EXIT /b %errorlevel%', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b'];
const NPM_PICK_NODE = [
  'IF EXIST "%dp0%\\node.exe" (',
  '  SET "_prog=%dp0%\\node.exe"',
  ') ELSE (',
  '  SET "_prog=node"',
  '  SET PATHEXT=%PATHEXT:;.JS;=;%',
  ')'
];
const NPM_RUN_NODE = String.raw`"%_prog%" ${ARGS} ${NPM_TARGET} %\*`;
// npm 7+ ends the batch scope before running node (npm/cli#969).
const NPM_END_LOCAL = String.raw`endLocal & goto #_undefined_# 2>NUL \|\| title %COMSPEC% & `;
const NPM_RUN_EXE = exact(String.raw`${NPM_TARGET}   %\*`);

const ZK_NODE_PATH: Line[] = [
  '@IF NOT DEFINED NODE_PATH (',
  exact(String.raw`  @SET "NODE_PATH=(?<nodePath>${NODE_PATH})"`),
  ') ELSE (',
  exact(String.raw`  @SET "NODE_PATH=(?<nodePath>${NODE_PATH});%NODE_PATH%"`),
  ')'
];
const zkPickNode = (setlocalInElse: boolean): Line[] => [
  '@IF EXIST "%~dp0\\node.exe" (',
  exact(String.raw`  "%~dp0\\node\.exe" ${ARGS} ${ZK_TARGET} %\*`),
  ') ELSE (',
  ...(setlocalInElse ? ['  @SETLOCAL'] : []),
  '  @SET PATHEXT=%PATHEXT:;.JS;=;%',
  exact(String.raw`  node ${ARGS} ${ZK_TARGET} %\*`),
  ')'
];
const ZK_FIXED_NODE = exact(String.raw`@"(?<node>[^"%!]+\\node\.exe)" ${ARGS} ${ZK_TARGET} %\*`);
const ZK_RUN_EXE = exact(String.raw`@${ZK_TARGET}   %\*`);

interface Template {
  kind: 'node' | 'exe';
  /** Whether the shim looks for `node.exe` next to itself first. */
  localNode: boolean;
  lines: Line[];
}

/** A pnpm template, with and without its `NODE_PATH` block after `@SETLOCAL`. */
function pnpm(kind: Template['kind'], localNode: boolean, body: Line[]): Template[] {
  return [
    { kind, localNode, lines: ['@SETLOCAL', ...body] },
    { kind, localNode, lines: ['@SETLOCAL', ...ZK_NODE_PATH, ...body] }
  ];
}

const TEMPLATES: Template[] = [
  { kind: 'node', localNode: true, lines: [...NPM_HEAD, '', ...NPM_PICK_NODE, '', exact(NPM_END_LOCAL + NPM_RUN_NODE)] },
  { kind: 'exe', localNode: false, lines: [...NPM_HEAD, NPM_RUN_EXE] },
  { kind: 'node', localNode: true, lines: [...NPM_V3_HEAD, '', ...NPM_PICK_NODE, '', exact(NPM_RUN_NODE), ...NPM_V3_TAIL] },
  { kind: 'exe', localNode: false, lines: [...NPM_V3_HEAD, NPM_RUN_EXE, ...NPM_V3_TAIL] },
  ...pnpm('node', true, zkPickNode(false)),
  ...pnpm('node', false, [ZK_FIXED_NODE]),
  ...pnpm('exe', false, [ZK_RUN_EXE]),
  { kind: 'node', localNode: true, lines: zkPickNode(true) },
  { kind: 'exe', localNode: false, lines: [ZK_RUN_EXE] }
];

/**
 * Match every line against `template`. A named group that appears on several
 * lines (target and args in both IF/ELSE branches, `NODE_PATH` in both of its
 * branches) must capture the same text each time.
 */
function matchTemplate(lines: string[], template: Line[]): Record<string, string> | null {
  if (lines.length !== template.length) return null;
  const groups: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const want = template[i]!;
    if (typeof want === 'string') {
      if (lines[i] !== want) return null;
      continue;
    }
    const m = lines[i]!.match(want);
    if (!m) return null;
    for (const [key, value = ''] of Object.entries(m.groups ?? {})) {
      if (key in groups && groups[key] !== value) return null;
      groups[key] = value;
    }
  }
  return groups;
}

/** `%dp0%\…` or `%~dp0\…` (the shim's folder plus a separator) as an absolute path. */
function resolveShimRelative(target: string, shimDir: string): string {
  const rest = target.replace(/^%~?dp0%?\\/, '');
  // The shim spells Windows separators; `/` is a separator on every platform.
  return normalize(join(shimDir, rest.replace(/\\/g, '/')));
}

/**
 * Parse a package-manager `.cmd` shim. Returns null for anything that isn't
 * exactly one of the generators' templates (see the module comment). Paths are
 * resolved against `shimDir`; whether they exist is checked at launch.
 */
export function parsePackageManagerShim(text: string, shimDir: string): PackageManagerShim | null {
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  for (const template of TEMPLATES) {
    const groups = matchTemplate(lines, template.lines);
    if (!groups) continue;
    const target = resolveShimRelative(groups.target!, shimDir);
    if (template.kind === 'exe') return /\.exe$/i.test(target) ? { kind: 'exe', command: target } : null;
    const node = groups.node;
    if (node !== undefined && !isAbsolute(node)) return null;
    return {
      kind: 'node',
      script: target,
      nodeArgs: groups.args ? groups.args.split(' ') : [],
      ...(node !== undefined ? { node } : {}),
      ...(template.localNode ? { localNode: join(shimDir, 'node.exe') } : {}),
      ...(groups.nodePath ? { nodePath: groups.nodePath } : {})
    };
  }
  return null;
}

type Env = Record<string, string | undefined>;

/** The env key Windows would match for `name` (case-insensitive), preferring the exact spelling. */
function envKey(env: Env, name: string): string | undefined {
  if (env[name] !== undefined) return name;
  return Object.keys(env).find((key) => key.toUpperCase() === name && env[key] !== undefined);
}

const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC';

/**
 * Find `node` on PATH the way cmd.exe does for the shim's bare `node`: each
 * PATH folder in order, each PATHEXT extension in order, after the shim's own
 * `SET PATHEXT=%PATHEXT:;.JS;=;%`. The first match must be an `.exe`; if a
 * `node.cmd`/`node.bat` (a version-manager shim) comes first, this returns
 * null and the launch keeps going through the original shim. cmd.exe would
 * search the current folder first; that is skipped on purpose, so a project
 * folder can't supply the program.
 */
export function nodeOnPath(env: Env): string | null {
  const pathKey = envKey(env, 'PATH');
  const extKey = envKey(env, 'PATHEXT');
  const pathext = (extKey ? env[extKey]! : DEFAULT_PATHEXT).replace(/;\.JS;/gi, ';');
  const exts = pathext.split(';').filter(Boolean);
  for (const raw of (pathKey ? env[pathKey]! : '').split(';')) {
    const dir = raw.trim().replace(/^"|"$/g, '');
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, `node${ext.toLowerCase()}`);
      if (isFile(candidate)) return /^\.exe$/i.test(ext) ? candidate : null;
    }
  }
  return null;
}

/**
 * The program, arguments and env change the shim would run with, or null when
 * a file it names is missing or node can't be resolved without cmd.exe. `env`
 * is the launch environment (PATH, PATHEXT and NODE_PATH are read from it).
 */
export function packageManagerShimLaunch(shim: PackageManagerShim, args: readonly string[], env: Env): PackageManagerLaunch | null {
  if (shim.kind === 'exe') return isFile(shim.command) ? { command: shim.command, args: [...args] } : null;
  if (!isFile(shim.script)) return null;
  const node = shim.node ?? (shim.localNode && isFile(shim.localNode) ? shim.localNode : nodeOnPath(env));
  if (!node || !isFile(node)) return null;
  const launch: PackageManagerLaunch = { command: node, args: [...shim.nodeArgs, shim.script, ...args] };
  if (shim.nodePath) {
    const key = envKey(env, 'NODE_PATH');
    const prior = key ? env[key] : undefined;
    launch.env = { [key ?? 'NODE_PATH']: prior ? `${shim.nodePath};${prior}` : shim.nodePath };
  }
  return launch;
}
