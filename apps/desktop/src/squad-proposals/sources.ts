import { constants } from 'node:fs';
import { readlink as nodeReadlink } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { SquadProposalErrorCode, SquadProposalSource } from '@zana-ai/zcc-domain/squad-proposal';
import {
  allowedLocationsText,
  displaySourcePath,
  resolveSourcePolicy,
  sourcePolicyText,
  sourceRefusal,
  type LinkFs,
  type SourcePolicy,
  type SourceRefusal
} from '@zana-ai/zcc-server/services/execution/source-policy';

export const FILE_MAX_BYTES = 4 * 1024 * 1024;
export const TOTAL_MAX_BYTES = 16 * 1024 * 1024;

export interface SquadSourceStat {
  isFile(): boolean;
  size: number;
  dev: number;
  ino: number;
  /** Hard-link count: realpath does not resolve hard links, so a linked file is refused. */
  nlink: number;
  /** Real stats have it; the link walk treats a stat without it as not a link. */
  isSymbolicLink?(): boolean;
}

export interface SquadSourceHandle {
  stat(): Promise<SquadSourceStat>;
  read(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}

export interface SquadProposalFs {
  realpath(path: string): Promise<string>;
  lstat(path: string): Promise<SquadSourceStat>;
  /** Used by the link walk; defaults to `fs/promises.readlink`. */
  readlink?(path: string): Promise<string>;
  /** Read-only open; `flags` carries O_NOFOLLOW so a final symlink is refused. */
  open(path: string, flags: number): Promise<SquadSourceHandle>;
}

/** Where sources may come from besides the project (HOME, the clone root), and what stays protected in them. */
export interface SquadSourceBases {
  home: string;
  cloneRoot?: string;
  dataDirs?: readonly string[];
  protectedRoots?: readonly string[];
}

/** The project root's realpath plus the policy every source of one proposal is checked against. */
export interface SquadSourceScope {
  projectRoot: string;
  policy: SourcePolicy;
}

type Failure = { ok: false; code: SquadProposalErrorCode; message: string };
/** A confined source and the device and inode its path resolved to when it was checked. */
export interface ConfinedSource { source: SquadProposalSource; identity: { dev: number; ino: number } }
export type Confined = ({ ok: true } & ConfinedSource) | Failure;

const fail = (code: SquadProposalErrorCode, message: string): Failure => ({ ok: false, code, message });

/** `real`'s path relative to `root` when it is strictly inside it, else undefined. */
function insideRoot(root: string, real: string): string | undefined {
  const rel = relative(root, real);
  return rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) ? undefined : rel;
}

/** The project and the shared source policy, resolved once per check. Undefined when the project folder is gone. */
export async function sourceScope(fs: SquadProposalFs, projectRoot: string, bases: SquadSourceBases): Promise<SquadSourceScope | undefined> {
  let root: string;
  try { root = await fs.realpath(projectRoot); } catch { return undefined; }
  return { projectRoot: root, policy: await resolveSourcePolicy(fs.realpath, { projectRoot: root, ...bases }) };
}

const linkFsOf = (fs: SquadProposalFs): LinkFs => ({ lstat: (path) => fs.lstat(path), readlink: (path) => (fs.readlink ?? nodeReadlink)(path) });

function refusedMessage(rawPath: string, refusal: SourceRefusal, policy: SourcePolicy): string {
  const text = sourcePolicyText(policy);
  if (refusal === 'sensitive') return `${rawPath} is in a protected location, so it can't be attached. ${text}`;
  if (refusal === 'links') return `${rawPath} is reached through too many links, so it can't be attached. ${text}`;
  return `${rawPath} is outside ${allowedLocationsText(policy).replace(/^the project/, 'this project')}, so it can't be attached. ${text}`;
}

/**
 * Resolve `rawPath` (relative paths against the project root) and require a regular file the
 * source policy allows. Symlinks are resolved first, so a link can't reach a refused file.
 */
export async function confineSource(fs: SquadProposalFs, scope: SquadSourceScope, rawPath: string): Promise<Confined> {
  const candidate = isAbsolute(rawPath) ? rawPath : resolve(scope.projectRoot, rawPath);
  let real: string;
  try { real = await fs.realpath(candidate); } catch { return fail('SOURCE_NOT_FILE', `${rawPath} does not exist or is not a file.`); }
  const refusal = await sourceRefusal(candidate, real, scope.policy, linkFsOf(fs));
  if (refusal) return fail('SOURCE_NOT_ALLOWED', refusedMessage(rawPath, refusal, scope.policy));
  let stat: SquadSourceStat;
  try { stat = await fs.lstat(real); } catch { return fail('SOURCE_NOT_FILE', `${rawPath} does not exist or is not a file.`); }
  if (!stat.isFile()) return fail('SOURCE_NOT_FILE', `${rawPath} is not a regular file.`);
  if (stat.nlink > 1) return fail('SOURCE_NOT_ALLOWED', `${rawPath} is a hard-linked file, so it can't be attached (it may be a second name for a protected file).`);
  const rel = insideRoot(scope.projectRoot, real);
  const source: SquadProposalSource = rel === undefined
    ? { path: real, relPath: displaySourcePath(real, scope.policy.home), bytes: stat.size, outsideProject: true }
    : { path: real, relPath: rel, bytes: stat.size };
  return { ok: true, source, identity: { dev: stat.dev, ino: stat.ino } };
}

export interface RefusedGoalPath {
  path: string;
  /** `outside-project`: allowed by the policy, but the card and composer only name `sources`, so it would reach the workers unseen. */
  reason: 'policy' | 'outside-project' | 'hard-linked';
}

/**
 * The absolute paths a goal names, cleaned of quotes and trailing punctuation, in order. Same
 * token rules as the host's goal-source discovery (`goalExecutionSourcePaths`): an `@path`
 * mention counts too, resolved against `projectRoot` when relative (and skipped without one).
 */
export function goalPathTokens(goal: string, projectRoot?: string): string[] {
  const raw: string[] = [];
  for (const m of goal.matchAll(/["'`]((?:[A-Za-z]:[/\\]|\/)[^"'`]+)["'`]/g)) if (m[1]) raw.push(m[1]);
  for (const m of goal.matchAll(/(?:^|[\s(])((?:[A-Za-z]:[/\\]|\/)[^\s`'"),;:]+)/g)) if (m[1]) raw.push(m[1]);
  for (const m of goal.matchAll(/(?:^|[\s(])@([^\s`'"),;:@]+)/g)) {
    if (!m[1]) continue;
    if (isAbsolute(m[1])) raw.push(m[1]);
    else if (projectRoot) raw.push(resolve(projectRoot, m[1]));
  }
  return raw.map((token) => token.trim().replace(/^[`'"(]+|[`'"),;:]+$/g, ''));
}

/**
 * Absolute paths named in a goal are attached as sources at Launch, so they follow the same
 * policy as `sources`. A goal path outside the Project is refused too unless it is one of the
 * proposal's own `sources` (`listedOutside`, realpaths): the card lists only `sources`, and the
 * user must see what leaves the checkout before Launch. A hard-linked file is refused, as Launch
 * would fail on it. Only a regular file is judged: folders (the Project root, HOME, `/usr/local`)
 * and other non-files are ignored, as Launch ignores them. Returns the first path it refuses;
 * paths that don't exist are ignored, as Launch ignores them too.
 */
export async function goalPathNotAllowed(
  fs: SquadProposalFs, scope: SquadSourceScope, goal: string, listedOutside: ReadonlySet<string> = new Set()
): Promise<RefusedGoalPath | undefined> {
  for (const cleaned of goalPathTokens(goal, scope.projectRoot)) {
    for (const candidate of cleaned.endsWith('.') ? [cleaned, cleaned.slice(0, -1)] : [cleaned]) {
      let real: string;
      try { real = await fs.realpath(candidate); } catch { continue; }
      // Only a regular file is attached at Launch: a folder or special file named in a goal is left alone.
      let stat: SquadSourceStat;
      try { stat = await fs.lstat(real); } catch { break; }
      if (!stat.isFile()) break;
      if (await sourceRefusal(candidate, real, scope.policy, linkFsOf(fs))) return { path: cleaned, reason: 'policy' };
      if (insideRoot(scope.projectRoot, real) === undefined && !listedOutside.has(real)) return { path: cleaned, reason: 'outside-project' };
      if (stat.nlink > 1) return { path: cleaned, reason: 'hard-linked' };
      break;
    }
  }
  return undefined;
}

async function readBounded(handle: SquadSourceHandle, size: number): Promise<string> {
  const buffer = Buffer.alloc(size + 1);
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
    if (!bytesRead) break;
    offset += bytesRead;
  }
  if (offset > size) throw new Error('source grew while it was read');
  return buffer.subarray(0, offset).toString('utf8');
}

const sameFile = (a: { dev: number; ino: number }, b: { dev: number; ino: number }): boolean => a.dev === b.dev && a.ino === b.ino;

/**
 * Read a confined source through one handle, opened without following a final symlink. The
 * handle must be the file (device and inode) recorded when the source was confined, and the
 * path must still resolve to that same file under the policy afterwards. A file or folder
 * swapped in after the check is refused. Node has no openat, so a folder that keeps flipping
 * to a symlink can only be narrowed, not ruled out; the agent could read such a file itself
 * anyway, so this guards what a Squad is handed, not a sandbox.
 */
export async function readConfinedSource(fs: SquadProposalFs, scope: SquadSourceScope, confined: ConfinedSource): Promise<string> {
  const { source, identity } = confined;
  const handle = await fs.open(source.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > FILE_MAX_BYTES) throw new Error('source is not a regular file within the size cap');
    if (opened.nlink > 1) throw new Error('source is a hard-linked file');
    if (!sameFile(opened, identity)) throw new Error('source changed after it was checked');
    const current = await confineSource(fs, scope, source.path);
    if (!current.ok || current.source.path !== source.path || !sameFile(current.identity, opened)) {
      throw new Error('source changed after it was checked');
    }
    return await readBounded(handle, opened.size);
  } finally {
    await handle.close();
  }
}
