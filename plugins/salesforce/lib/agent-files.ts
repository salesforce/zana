import { createHash } from 'node:crypto';
import { basename, relative, sep } from 'node:path';
import { isDxProject, listFilesRecursive, resolveUnderRoot } from './dx-project.js';
import { inspectAgentSource, scanAgentBundles } from './agent.js';
import { isAgentScriptFile } from './agent-script-model.js';
import type { SalesforceDeps } from './types.js';

export interface AgentFileListItem {
  apiName: string;
  path: string;
  lines: number;
}

export type AgentFilesErrorCode =
  | 'not_configured'
  | 'path_refused'
  | 'not_found'
  | 'invalid_input'
  | 'sha_mismatch'
  | 'write_unavailable';

export interface AgentFilesRootOptions {
  /** When true, the folder need not contain sfdx-project.json. */
  allowNonDx?: boolean;
}

export class AgentFilesError extends Error {
  readonly code: AgentFilesErrorCode;
  constructor(code: AgentFilesErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function toPosixRelative(root: string, absolute: string): string {
  return relative(root, absolute).split(sep).join('/');
}

export function requireDxProjectRoot(projectRoot: string, deps: SalesforceDeps): string {
  const root = projectRoot.trim();
  if (!root || !isDxProject(root, deps.exists)) {
    throw new AgentFilesError('not_configured', 'Set a DX project root that contains sfdx-project.json.');
  }
  return deps.realpath(root);
}

export function requireScanRoot(projectRoot: string, deps: SalesforceDeps): string {
  const root = projectRoot.trim();
  if (!root) {
    throw new AgentFilesError('not_configured', 'Open a project folder that contains Agentforce .agent files.');
  }
  const real = deps.realpath(root);
  if (deps.stat(real) !== 'dir') {
    throw new AgentFilesError('not_found', `Project folder not found: ${projectRoot}`);
  }
  return real;
}

function resolveAgentRoot(projectRoot: string, deps: SalesforceDeps, options?: AgentFilesRootOptions): string {
  return options?.allowNonDx ? requireScanRoot(projectRoot, deps) : requireDxProjectRoot(projectRoot, deps);
}

export function confineAgentPath(projectRoot: string, candidate: string, deps: SalesforceDeps): string {
  const confined = resolveUnderRoot(projectRoot, candidate, deps.realpath);
  if (!confined || !isAgentScriptFile(confined)) {
    throw new AgentFilesError(
      'path_refused',
      'Agentforce path must stay inside the project folder and end in .agent or .afscript.'
    );
  }
  return confined;
}

function collectAgentFiles(root: string, deps: SalesforceDeps): AgentFileListItem[] {
  const bundles = isDxProject(root, deps.exists)
    ? scanAgentBundles(root, deps)
    : listFilesRecursive(root, deps)
        .filter((file) => file.toLowerCase().endsWith('.agent'))
        .map((file) => inspectAgentSource(file, deps.readFile(file) ?? ''));
  return bundles
    .map((row) => ({
      apiName: row.apiName,
      path: toPosixRelative(root, row.path),
      lines: row.lines
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function listAgentFiles(
  projectRoot: string,
  deps: SalesforceDeps,
  options?: AgentFilesRootOptions
): AgentFileListItem[] {
  return collectAgentFiles(resolveAgentRoot(projectRoot, deps, options), deps);
}

export function readAgentFile(
  projectRoot: string,
  candidate: string,
  deps: SalesforceDeps,
  options?: AgentFilesRootOptions
): { path: string; content: string; sha256: string; apiName: string } {
  const root = resolveAgentRoot(projectRoot, deps, options);
  const absolute = confineAgentPath(root, candidate, deps);
  if (deps.stat(absolute) === 'missing') {
    throw new AgentFilesError('not_found', `Agentforce file not found: ${candidate}`);
  }
  const content = deps.readFile(absolute) ?? '';
  return {
    path: toPosixRelative(root, absolute),
    content,
    sha256: sha256Hex(content),
    apiName: basename(absolute).replace(/\.(agent|afscript)$/i, '')
  };
}

export function writeAgentFile(
  projectRoot: string,
  candidate: string,
  content: string,
  deps: SalesforceDeps,
  expectedSha256?: string,
  options?: AgentFilesRootOptions
): { path: string; sha256: string } {
  if (typeof content !== 'string') {
    throw new AgentFilesError('invalid_input', 'write requires string content.');
  }
  const root = resolveAgentRoot(projectRoot, deps, options);
  const absolute = confineAgentPath(root, candidate, deps);
  const existing = deps.stat(absolute) === 'missing' ? null : (deps.readFile(absolute) ?? '');
  if (expectedSha256) {
    const current = existing === null ? '' : sha256Hex(existing);
    if (current !== expectedSha256) {
      throw new AgentFilesError('sha_mismatch', 'Agentforce file changed on disk. Reload before saving.');
    }
  }
  deps.writeFile(absolute, content);
  return { path: toPosixRelative(root, absolute), sha256: sha256Hex(content) };
}
