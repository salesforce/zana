import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { ToolkitDescription } from './tool-provider-contract.js';

const PATH_KEYS = new Set(['agent_file', 'file', 'files', 'test_file', 'package_dir', 'source_paths', 'manifest', 'output_path', 'output_dir', 'output_file', 'output_files', 'config_file', 'report_file', 'spec_path', 'release_spec_path', 'csv_path', 'csv_file', 'input_file', 'input_path', 'manifest_path']);
const HOST_KEYS = new Set(['projectId', 'threadId', 'orgAlias', 'artifactDir', 'resume', 'allowEffects', 'allow_effects', 'onAuthorization', 'username_override']);
export class ToolkitPolicyError extends Error {}

export function isLocalToolkitCall(name: string, input: Record<string, any>): boolean {
  const action = String(input.action ?? '');
  if (['help', 'actions.list', 'actions.search', 'action.describe', 'examples.get'].includes(action)) return true;
  if (name === 'sf_lwc' || name === 'code_analyzer') return true;
  if (name === 'sf_flow') return ['quality.rules', 'author.plan', 'project.scan', 'diagnose.file', 'fix.apply'].includes(action) || (action === 'flow.inspect' && Boolean(input.file));
  if (name === 'sf_apex') return ['diagnose.file', 'author.plan', 'log.analyze'].includes(action) && (action !== 'log.analyze' || Boolean(input.file));
  if (name === 'sf_soql') return action === 'lsp.status';
  if (name === 'sf_metadata') return ['manifest', 'deploy.preview'].includes(action);
  if (name === 'data360_prepare') return ['csv_schema.infer', 'csv.infer_schema'].includes(action);
  if (name === 'agentscript_authoring') return !['check_targets', 'runtime_smoke', 'review'].includes(input.mode) && input.fallback !== 'server' && input.verb !== 'compile_server';
  return false;
}

/** Optional outputs/fallbacks can turn a nominal read into an effect. Err on the declared effectful side. */
export function toolkitRequiresApproval(description: ToolkitDescription, input: Record<string, any>): boolean {
  const action = input.action ?? (input.verb === 'create' ? 'create' : `${input.verb}.${input.mode ?? (input.verb === 'compile' ? 'check' : 'structure')}`);
  const capability = description.actions[action];
  if (!capability) return true;
  const derived = Boolean(input.output_path || input.output_files?.length || input.output_file || input.fallback === 'server');
  return derived || Boolean(capability.effects && !(capability.dryRun && input.dry_run === true));
}

/** Check existing ancestors too: output files must not escape through a symlink or a dangling link. */
export async function confinedToolkitPath(root: string, supplied: string): Promise<string> {
  root = await realpath(root);
  if (typeof supplied !== 'string') throw new ToolkitPolicyError('Use a concrete path inside this project.');
  const value = supplied.startsWith('@') ? supplied.slice(1) : supplied;
  if (!value || value.includes('\0') || /[*?\[\]{}]/.test(value) || value.startsWith('~')) throw new ToolkitPolicyError('Use a concrete path inside this project.');
  const candidate = isAbsolute(value) ? value : resolve(root, value);
  async function canonical(path: string): Promise<string> {
    const info = await lstat(path).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (info) return realpath(path); // Dangling symlinks fail here rather than falling back to their parent.
    const parent = dirname(path); if (parent === path) throw new ToolkitPolicyError('Path is unavailable.');
    return resolve(await canonical(parent), relative(parent, path));
  }
  const resolved = await canonical(candidate);
  if (resolved !== root && !resolved.startsWith(root + sep)) throw new ToolkitPolicyError('Toolkit paths must stay inside the registered project.');
  return resolved;
}

export async function prepareToolkitInput(name: string, raw: unknown, root: string, org: string | null): Promise<Record<string, any>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || JSON.stringify(raw).length > 200_000) throw new ToolkitPolicyError('Tool input must be a JSON object of at most 200,000 characters.');
  const input = structuredClone(raw) as Record<string, any>;
  async function visit(object: Record<string, any>, depth = 0): Promise<void> {
    if (depth > 16) throw new ToolkitPolicyError('Tool input is too deeply nested.');
    for (const [key, value] of Object.entries(object)) {
      if (HOST_KEYS.has(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new ToolkitPolicyError(`${key} is owned by the host.`);
      if (key === 'target_org') { if (depth || value !== org) throw new ToolkitPolicyError('Use the project’s selected org; change it through sf_workbench context.select.'); delete object[key]; continue; }
      if (key === 'workspace') {
        const values = Array.isArray(value) ? value : [value];
        if (!values.every(v => typeof v === 'string' && (v === '.' || v === root))) throw new ToolkitPolicyError('Workspace is owned by the registered project.');
        object[key] = Array.isArray(value) ? value.map(() => root) : root;
      } else if (key === 'manifest' && name.startsWith('data360_') && value && typeof value === 'object' && !Array.isArray(value)) {
        await visit(value, depth + 1);
      } else if (key === 'output_files' && Array.isArray(value) && value.every(v => v && typeof v === 'object')) {
        for (const child of value) { await confinedToolkitPath(root, child.path); await visit(child, depth + 1); }
      } else if (PATH_KEYS.has(key) || /(?:_file|_path|_dir|File|Path|Dir)$/.test(key) || (key === 'path' && name === 'data360_prepare' && input.action.includes('upload_csv')) || (name === 'code_analyzer' && key === 'target') || (name === 'sf_apex' && ['target', 'targets'].includes(key))) {
        const values = Array.isArray(value) ? value : [value];
        for (const path of values) {
          if (typeof path !== 'string') throw new ToolkitPolicyError(`${key} must contain file paths.`);
          if (name === 'sf_apex' && ['target', 'targets'].includes(key) && /^[A-Za-z][A-Za-z0-9_]*$/.test(path)) continue;
          const canonical = await confinedToolkitPath(root, path);
          if (Array.isArray(value)) value[value.indexOf(path)] = canonical;
          else object[key] = canonical;
        }
      } else if (value && typeof value === 'object') {
        for (const child of Array.isArray(value) ? value : [value]) if (child && typeof child === 'object') await visit(child, depth + 1);
      }
    }
  }
  await visit(input);
  return input;
}

export function redactToolkitResult(value: any, depth = 0): any {
  if (depth > 32) return '[omitted]';
  if (Array.isArray(value)) return value.map(item => redactToolkitResult(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    /(?:access.?token|refresh.?token|password|client.?secret|private.?key|authorization|cookie)/i.test(key) ? '[redacted]' : redactToolkitResult(item, depth + 1)
  ]));
}
