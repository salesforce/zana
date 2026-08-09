/**
 * Read/write `.claude/settings.json` and `.claude/settings.local.json` for a
 * project. We surface a curated subset of fields in the UI (permissions,
 * model) and preserve everything else verbatim so atomic edits don't
 * clobber hand-edited keys (env, hooks, outputStyle, etc.).
 */

import { join } from 'node:path';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import type {
  ClaudeProjectSettings,
  ClaudeSettingsResult,
  ClaudeSettingsScope
} from '../shared/types.js';

/** Keys we expose in the typed view. Anything else round-trips via `_unknown`. */
const KNOWN_TOP_LEVEL = new Set(['permissions', 'model']);
const KNOWN_PERMISSIONS = new Set(['allow', 'deny', 'defaultMode', 'additionalDirectories']);

const VALID_DEFAULT_MODES = new Set(['default', 'acceptEdits', 'plan', 'bypassPermissions']);

function fileNameForScope(scope: ClaudeSettingsScope): string {
  return scope === 'shared' ? 'settings.json' : 'settings.local.json';
}

function pathFor(projectPath: string, scope: ClaudeSettingsScope): string {
  return join(projectPath, '.claude', fileNameForScope(scope));
}

function asObject(v: unknown): Record<string, unknown> | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item === 'string') out.push(item);
  }
  return out;
}

/** Split a parsed settings object into typed view + unknown remainder. */
function projectSettingsFromRaw(raw: Record<string, unknown>): ClaudeProjectSettings {
  const out: ClaudeProjectSettings = {};
  const unknownTop: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (!KNOWN_TOP_LEVEL.has(key)) {
      unknownTop[key] = value;
      continue;
    }
    if (key === 'model' && typeof value === 'string') {
      out.model = value;
      continue;
    }
    if (key === 'permissions') {
      const perm = asObject(value);
      if (!perm) {
        unknownTop[key] = value;
        continue;
      }
      const permView: NonNullable<ClaudeProjectSettings['permissions']> = {};
      const unknownPerm: Record<string, unknown> = {};
      for (const [pk, pv] of Object.entries(perm)) {
        if (!KNOWN_PERMISSIONS.has(pk)) {
          unknownPerm[pk] = pv;
          continue;
        }
        if (pk === 'allow' || pk === 'deny' || pk === 'additionalDirectories') {
          const arr = asStringArray(pv);
          if (arr !== undefined) permView[pk] = arr;
          else unknownPerm[pk] = pv;
        } else if (pk === 'defaultMode' && typeof pv === 'string' && VALID_DEFAULT_MODES.has(pv)) {
          permView.defaultMode = pv as NonNullable<typeof permView.defaultMode>;
        } else {
          unknownPerm[pk] = pv;
        }
      }
      out.permissions = permView;
      if (Object.keys(unknownPerm).length > 0) {
        out._unknownPermissions = unknownPerm;
      }
    }
  }

  if (Object.keys(unknownTop).length > 0) {
    out._unknown = unknownTop;
  }
  return out;
}

/** Inverse of projectSettingsFromRaw — bake typed view + unknown back into a raw object. */
function projectSettingsToRaw(view: ClaudeProjectSettings): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(view._unknown ?? {}) };
  if (view.permissions) {
    const perm: Record<string, unknown> = { ...(view._unknownPermissions ?? {}) };
    if (view.permissions.allow && view.permissions.allow.length > 0) {
      perm.allow = view.permissions.allow;
    }
    if (view.permissions.deny && view.permissions.deny.length > 0) {
      perm.deny = view.permissions.deny;
    }
    if (
      view.permissions.additionalDirectories &&
      view.permissions.additionalDirectories.length > 0
    ) {
      perm.additionalDirectories = view.permissions.additionalDirectories;
    }
    if (view.permissions.defaultMode) {
      perm.defaultMode = view.permissions.defaultMode;
    }
    if (Object.keys(perm).length > 0) {
      out.permissions = perm;
    }
  } else if (view._unknownPermissions && Object.keys(view._unknownPermissions).length > 0) {
    out.permissions = { ...view._unknownPermissions };
  }
  if (view.model) {
    out.model = view.model;
  }
  return out;
}

/** Read a project's claude settings file at the given scope. Missing → empty view. */
export async function readClaudeProjectSettings(
  projectPath: string,
  scope: ClaudeSettingsScope
): Promise<ClaudeSettingsResult> {
  const target = pathFor(projectPath, scope);
  let raw: unknown;
  try {
    const text = await readFile(target, 'utf-8');
    raw = JSON.parse(text);
  } catch {
    return { exists: false, path: target, settings: {} };
  }
  const obj = asObject(raw);
  if (!obj) {
    return { exists: true, path: target, settings: {} };
  }
  return { exists: true, path: target, settings: projectSettingsFromRaw(obj) };
}

/**
 * Atomically rewrite a project's claude settings file at the given scope.
 * Merges the patch into the existing typed view, preserves unknown keys
 * verbatim, and deletes the file when the result would be empty.
 */
export async function writeClaudeProjectSettings(
  projectPath: string,
  scope: ClaudeSettingsScope,
  patch: ClaudeProjectSettings
): Promise<ClaudeSettingsResult> {
  const target = pathFor(projectPath, scope);
  const dir = join(projectPath, '.claude');

  // Read existing file to keep _unknown / _unknownPermissions intact.
  const current = await readClaudeProjectSettings(projectPath, scope);
  const merged: ClaudeProjectSettings = {
    ...current.settings,
    ...patch
  };
  // Permissions need a shallow merge so a partial patch (e.g. only allow[])
  // doesn't wipe defaultMode.
  if (patch.permissions || current.settings.permissions) {
    merged.permissions = {
      ...(current.settings.permissions ?? {}),
      ...(patch.permissions ?? {})
    };
  }

  const raw = projectSettingsToRaw(merged);

  await mkdir(dir, { recursive: true });
  const json = JSON.stringify(raw, null, 2) + '\n';
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, json, 'utf-8');
  await rename(tmp, target);
  return { exists: true, path: target, settings: merged };
}
