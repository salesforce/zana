import path from 'node:path';
import {
  MANAGED_WORKTREE_DIR_NAME,
  PERSONAL_WORKSPACE_DIR_NAME
} from '@zana-ai/zcc-domain';

const REPO_DIR_NAME_PATTERN = /^[A-Za-z0-9._][A-Za-z0-9._-]*$/;

export function deriveRepoDirName(sourcePath: string): string {
  const trimmed = sourcePath.replace(/\/+$/, '');
  const scpMatch = trimmed.match(/^[^:/]+@[^:]+:(.+)$/);
  const pathPart = scpMatch?.[1] ?? tryParseUrlPath(trimmed) ?? trimmed;
  const basename = path.posix.basename(pathPart.replace(/\\/g, '/'));
  const candidate = basename.endsWith('.git') ? basename.slice(0, -'.git'.length) : basename;
  if (!candidate || candidate === '.' || candidate === '..' || !REPO_DIR_NAME_PATTERN.test(candidate)) {
    throw new Error(`Cannot derive repository directory name from source "${sourcePath}"`);
  }
  return candidate;
}

function tryParseUrlPath(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'ssh:') {
      return url.pathname;
    }
  } catch {
    // not a URL
  }
  return null;
}

export function resolveManagedTargetPath(args: {
  dataDir: string;
  environmentId: string;
  sourcePath: string;
}): string {
  return path.posix.join(args.dataDir, MANAGED_WORKTREE_DIR_NAME, args.environmentId, deriveRepoDirName(args.sourcePath));
}

export function resolvePersonalTargetPath(args: { dataDir: string; environmentId: string }): string {
  return path.posix.join(args.dataDir, PERSONAL_WORKSPACE_DIR_NAME, args.environmentId);
}

export function isZccManagedWorkspacePath(args: { dataDir: string; path: string }): boolean {
  const roots = [
    path.posix.join(args.dataDir, MANAGED_WORKTREE_DIR_NAME),
    path.posix.join(args.dataDir, PERSONAL_WORKSPACE_DIR_NAME)
  ];
  return roots.some((root) => args.path === root || args.path.startsWith(`${root}/`));
}

export function isLegacyWorktreePath(homeDir: string, candidate: string): boolean {
  const root = path.join(homeDir, 'zcc-worktrees');
  return candidate === root || candidate.startsWith(`${root}/`);
}
