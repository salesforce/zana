import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { sha256Hex } from './agent-files.js';

export const DRAFT_PROJECT = 'agentforce-drafts';
const API_NAME = /^[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)*$/;
export const DRAFT_METADATA = '<?xml version="1.0" encoding="UTF-8"?>\n<AiAuthoringBundle xmlns="http://soap.sforce.com/2006/04/metadata">\n  <bundleType>AGENT</bundleType>\n</AiAuthoringBundle>\n';
import type { AgentDraftInput, CreatedAgentDraft } from './agent-draft-contract.js';

function segments(path: string) {
  if (!path || isAbsolute(path) || /[\\\0:]/.test(path) || path.split('/').some(p => !p || p === '.' || p === '..')) throw Error('Choose a package directory inside this project.');
  return path.split('/');
}
function directory(root: string, parts: string[], create = false) {
  let path = root;
  for (const part of parts) {
    path = join(path, part);
    if (!existsSync(path)) {
      // lstat detects dangling symlinks too; mkdir never follows them.
      if (!create) continue;
      try { mkdirSync(path, { mode: 0o700 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    }
    if (existsSync(path) && (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory() || !realpathSync(path).startsWith(root + sep))) throw Error('Agent folders must stay inside this project and cannot be symbolic links.');
  }
  return path;
}
function manifest(path: string): { packageDirectories: Array<{ path: string; default?: boolean }> } {
  if (lstatSync(path).isSymbolicLink() || lstatSync(path).size > 64_000) throw Error('Invalid Salesforce project configuration.');
  const result = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(result.packageDirectories) || !result.packageDirectories.length) throw Error('This DX project has no package directory.');
  return result;
}
export function draftDestination(projectRoot: string) {
  const root = realpathSync(projectRoot);
  if (!lstatSync(root).isDirectory()) throw Error('Open a local project to create an agent.');
  const nested = !existsSync(join(root, 'sfdx-project.json'));
  const dxRoot = nested ? directory(root, [DRAFT_PROJECT]) : root;
  const configPath = join(dxRoot, 'sfdx-project.json');
  const packages = existsSync(configPath) ? manifest(configPath).packageDirectories : [{ path: 'force-app', default: true }];
  const pkg = packages.find(p => p.default) ?? packages[0];
  if (!pkg || typeof pkg.path !== 'string') throw Error('Invalid Salesforce package directory.');
  const parts = [...(nested ? [DRAFT_PROJECT] : []), ...segments(pkg.path), 'main', 'default', 'aiAuthoringBundles'];
  directory(root, parts);
  return { root, dxRoot, parts, directory: parts.join('/'), initializesProject: nested && !existsSync(configPath) };
}
export function agentDraftSource(input: AgentDraftInput): string {
  const name = input.name?.trim();
  if (!name || name.length > 120 || /[\0\r\n]/.test(name)) throw Error('Enter an agent name of 1–120 characters.');
  if (typeof input.apiName !== 'string' || !API_NAME.test(input.apiName) || input.apiName.length > 80) throw Error('API name must start with a letter and contain letters, numbers, or single underscores.');
  if (input.purpose !== undefined && (typeof input.purpose !== 'string' || input.purpose.length > 4000)) throw Error('Purpose must be at most 4,000 characters.');
  if (input.source !== undefined) {
    if (typeof input.source !== 'string' || !input.source.trim() || input.source.length > 180_000) throw Error('Draft source must contain 1–180,000 characters.');
    // A new draft is a new local identity; never inherit the source's name or metadata target.
    if (!/^\s+agent_name:\s*.*$/m.test(input.source)) throw Error('Source must include config.agent_name.');
    return input.source.replace(/^(\s+agent_name:)\s*.*$/m, `$1 ${JSON.stringify(input.apiName)}`);
  }
  return `# @dialect:agentforce\nconfig:\n    agent_name: ${JSON.stringify(input.apiName)}\n\nsystem:\n    instructions: ${JSON.stringify(input.purpose?.trim() || 'Help the user with clear, concise answers. Ask for missing details and stay within your capabilities.')}\n\nstart_agent welcome:\n    description: ${JSON.stringify(name)}\n    reasoning:\n        instructions: ->\n            | Welcome the user and ask how you can help.\n            | Do not claim to have performed actions that are not available.\n`;
}

/** Synchronous, bounded staging keeps creation serialized and publishes the pair together. */
export function createAgentDraft(projectRoot: string, input: AgentDraftInput): CreatedAgentDraft {
  const source = agentDraftSource(input);
  const destination = draftDestination(projectRoot);
  const parent = directory(destination.root, destination.parts, true);
  const config = join(destination.dxRoot, 'sfdx-project.json');
  if (destination.initializesProject) writeFileSync(config, JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }], namespace: '', sourceApiVersion: '66.0' }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  const target = join(parent, input.apiName);
  try { lstatSync(target); throw Error('An agent with this API name already exists. Choose another name.'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const staging = join(parent, `.new-${randomUUID()}`);
  mkdirSync(staging, { mode: 0o700 });
  try {
    writeFileSync(join(staging, `${input.apiName}.agent`), source, { flag: 'wx', mode: 0o600 });
    writeFileSync(join(staging, `${input.apiName}.bundle-meta.xml`), DRAFT_METADATA, { flag: 'wx', mode: 0o600 });
    renameSync(staging, target);
  } finally { rmSync(staging, { recursive: true, force: true }); }
  const path = relative(destination.root, join(target, `${input.apiName}.agent`)).split(sep).join('/');
  return { path, metadataPath: path.replace(/\.agent$/, '.bundle-meta.xml'), projectRoot: relative(destination.root, destination.dxRoot).split(sep).join('/') || '.', apiName: input.apiName, sha256: sha256Hex(source) };
}
