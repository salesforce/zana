/**
 * Install the global `zcc-cli` skill into `~/.claude/skills/`.
 *
 * Product skills live in `apps/server/src/plugins/builtin-skills/` and are
 * injected into threads via `injected-skill-roots.json`. Only `zcc-cli` is
 * *also* copied to `~/.claude/skills` (and host `~/.agents/skills` via
 * install-cli-skills) so agents outside ZCC can drive the CLI.
 *
 * Idempotent + edit-respecting: we only (re)write when the on-disk content
 * differs from what we ship.
 */

import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile, mkdir, rename, readdir, rm } from 'node:fs/promises';
import { resolveContainedReal } from '@zana-ai/zcc-path-confine';
import { builtinSkillsRootPath } from '../../plugins/injected-skill-roots.js';
import { discoverPluginSkillNames } from '../../plugins/plugin-skills.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));

const SKILLS_ROOT = join(homedir(), '.claude', 'skills');
const ZCC_CLI_SKILL_DIR = join(SKILLS_ROOT, 'zcc-cli');
const ZCC_CLI_SKILL_FILE = join(ZCC_CLI_SKILL_DIR, 'SKILL.md');

/**
 * Resolve a shipped skill file. Prefer the in-thread builtin-skills tree
 * (`<slug>/SKILL.md`). Packaged builds also copy that tree to
 * `process.resourcesPath/builtin-skills`. Legacy `resources/<name>-skill.md`
 * copies remain only for maintainer-only skills (harness-authoring).
 */
function resolveShippedPath(fileName: string): string | null {
  const builtinSlug = fileName.replace(/-skill\.md$/, '');
  const resourcesPath =
    typeof process.resourcesPath === 'string' && process.resourcesPath.length > 0
      ? process.resourcesPath
      : null;
  const candidates = [
    join(builtinSkillsRootPath(), builtinSlug, 'SKILL.md'),
    resourcesPath ? join(resourcesPath, 'builtin-skills', builtinSlug, 'SKILL.md') : null,
    resourcesPath ? join(resourcesPath, fileName) : null,
    join(moduleDir, `../../resources/${fileName}`),
    join(moduleDir, `../../../resources/${fileName}`),
    join(moduleDir, `../../../../../resources/${fileName}`)
  ].filter((p): p is string => !!p);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

export const ZCC_CLI_SKILL_RESOURCE = 'zcc-cli-skill.md';
export const ZCC_CLI_SKILL_NAME = 'zcc-cli';

export function readBundledSkillMarkdown(resourceFile: string): string | null {
  const src = resolveShippedPath(resourceFile);
  if (!src) return null;
  try {
    return readFileSync(src, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Deploy one bundled SKILL.md if needed. Best-effort: never throws — a failure
 * here must not block app boot (a read-only home dir, missing resource, etc.).
 * Idempotent + edit-respecting: only (re)writes when the on-disk content
 * differs from what we ship. Returns the install path on success, else null.
 */
async function installSkill(
  context: string,
  resourceFile: string,
  dir: string,
  file: string,
  log?: (context: string, err: unknown) => void
): Promise<string | null> {
  try {
    const src = resolveShippedPath(resourceFile);
    if (!src) {
      log?.(context, new Error(`shipped ${resourceFile} not found`));
      return null;
    }
    const shipped = await readFile(src, 'utf-8');

    // Skip the write when the file already matches what we ship — avoids churn
    // and keeps any in-session user edits until the shipped content changes.
    let current: string | null = null;
    try {
      current = await readFile(file, 'utf-8');
    } catch {
      current = null; // not installed yet
    }
    if (current === shipped) return file;

    await mkdir(dir, { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, shipped, 'utf-8');
    await rename(tmp, file);
    return file;
  } catch (err) {
    log?.(context, err);
    return null;
  }
}

/** Deploy the global `zcc-cli` skill (drive/inspect the app via the `zcc` CLI). */
async function installZccCliSkill(
  log?: (context: string, err: unknown) => void
): Promise<string | null> {
  return installSkill('installZccCliSkill', 'zcc-cli-skill.md', ZCC_CLI_SKILL_DIR, ZCC_CLI_SKILL_FILE, log);
}

/**
 * One entry per skill copied to `~/.claude/skills` at boot / Redeploy.
 * Other product skills stay in `builtin-skills/` and are injected at thread spawn.
 */
const BUNDLED_SKILLS: ReadonlyArray<{
  name: string;
  install: (log?: (context: string, err: unknown) => void) => Promise<string | null>;
}> = [
  { name: 'zcc-cli', install: installZccCliSkill }
];

/** The bundled-skill names, for callers that only need the roster (e.g. boot). */
export const BUNDLED_SKILL_NAMES: readonly string[] = BUNDLED_SKILLS.map((s) => s.name);

/**
 * Re-run every bundled-skill installer on demand (the "Redeploy bundled skills"
 * button). Same idempotent, edit-respecting write as boot — a skill whose
 * on-disk copy already matches what we ship is left untouched (so a user's local
 * tweak survives until the shipped content bumps). Never throws: each installer
 * is best-effort and a failure is reported as `ok: false` for that name.
 *
 * Returns a per-skill outcome so the renderer can surface what happened. This is
 * the runtime twin of the boot fan-out in index.ts — the ONLY reason it lives
 * here (not index.ts) is so the roster + the write policy stay in one file.
 */
export async function redeployBundledSkills(
  log?: (context: string, err: unknown) => void
): Promise<Array<{ name: string; ok: boolean }>> {
  return Promise.all(
    BUNDLED_SKILLS.map(async (s) => {
      const path = await s.install(log).catch(() => null);
      return { name: s.name, ok: path !== null };
    })
  );
}

/**
 * Rule 5: max skill contributions applied from one extension's manifest.
 * Mirrors PERSONAS_PER_EXTENSION_MAX's order of magnitude — excess entries
 * are sliced off, never processed.
 */
export const SKILLS_PER_EXTENSION_MAX = 20;

/**
 * Slug a raw skill slug/basename into a filesystem-safe stem — same shape as
 * `PersonaTeamRegistry`'s `slugId` so extension-derived dir names stay
 * consistent app-wide.
 */
function slugify(raw: string, fallback: string): string {
  const base = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return base || fallback;
}

/** Narrow shape `deploySkillsForExtension` needs — a leaf, no dependency on ExtensionEntry. */
export interface SkillContributor {
  id: string;
  /** Absolute root dir of the extension (Rule 2: skill `path` is confined against this). */
  path: string;
  enabled: boolean;
  consented: boolean;
  manifest: {
    permissions?: string[];
    skills?: Array<{ path: string; slug?: string }>;
  } | null;
}

/** The `ext-<id>-<slug>` skill dir name a contribution deploys under. */
function extSkillDirName(extId: string, slug: string): string {
  return `ext-${slugify(extId, 'ext')}-${slugify(slug, 'skill')}`;
}

/**
 * Deploy every skill this extension declares (agent-contributed, gated on
 * `agent:contribute` + enabled + consented — same posture as
 * `rebuildExtensionServers`). Each entry's `path` is confined against the
 * extension's OWN dir (Rule 2, `resolveContainedReal` — defends against a
 * symlink escape too), never trusted as-is. Reuses `installSkill`'s
 * idempotent tmp+rename write, so a user's local edit to a deployed skill
 * survives until the extension's shipped content actually changes.
 * Best-effort: one malformed/escaping entry is skipped, never blocks the rest.
 */
export async function deploySkillsForExtension(
  ext: SkillContributor,
  log?: (context: string, err: unknown) => void
): Promise<Array<{ name: string; ok: boolean }>> {
  try {
    if (!ext.enabled || !ext.consented) return [];
    const perms = ext.manifest?.permissions ?? [];
    if (!perms.includes('agent:contribute')) return [];
    const skills = (ext.manifest?.skills ?? []).slice(0, SKILLS_PER_EXTENSION_MAX);
    const out: Array<{ name: string; ok: boolean }> = [];
    for (const s of skills) {
      const dirName = extSkillDirName(ext.id, s.slug || basenameNoExt(s.path));
      try {
        const src = await resolveContainedReal(ext.path, s.path);
        if (!src) {
          log?.(`deploySkillsForExtension:${ext.id}`, new Error(`skill path escapes extension dir: ${s.path}`));
          out.push({ name: dirName, ok: false });
          continue;
        }
        const shipped = await readFile(src, 'utf-8');
        const dir = join(SKILLS_ROOT, dirName);
        const file = join(dir, 'SKILL.md');
        let current: string | null = null;
        try {
          current = await readFile(file, 'utf-8');
        } catch {
          current = null;
        }
        if (current !== shipped) {
          await mkdir(dir, { recursive: true });
          const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
          await writeFile(tmp, shipped, 'utf-8');
          await rename(tmp, file);
        }
        out.push({ name: dirName, ok: true });
      } catch (err) {
        log?.(`deploySkillsForExtension:${ext.id}`, err);
        out.push({ name: dirName, ok: false });
      }
    }
    return out;
  } catch (err) {
    log?.(`deploySkillsForExtension:${ext.id}`, err);
    return [];
  }
}

function basenameNoExt(p: string): string {
  const base = p.split('/').pop() ?? p;
  return base.replace(/\.[^.]+$/, '');
}

/**
 * Remove every `ext-<id>-*` skill dir previously deployed for this extension
 * (disable/uninstall — a disabled extension's skill must stop being
 * agent-visible immediately, same spirit as personas/teams clearing on
 * teardown). Scans `SKILLS_ROOT` rather than re-reading the (possibly stale
 * or already-removed) manifest, so it also cleans up a skill whose `slug`
 * changed or was dropped in the new version. Best-effort: never throws.
 */
export async function removeSkillsForExtension(
  extId: string,
  log?: (context: string, err: unknown) => void
): Promise<void> {
  try {
    const prefix = `ext-${slugify(extId, 'ext')}-`;
    const entries = await readdir(SKILLS_ROOT).catch(() => [] as string[]);
    await Promise.all(
      entries
        .filter((name) => name.startsWith(prefix))
        .map((name) => rm(join(SKILLS_ROOT, name), { recursive: true, force: true }).catch((err) => log?.(`removeSkillsForExtension:${extId}`, err)))
    );
  } catch (err) {
    log?.(`removeSkillsForExtension:${extId}`, err);
  }
}

/**
 * Declarative sync entry point — the skill-contribution twin of
 * `rebuildExtensionServers`. Call it from every choke point that already
 * recomputes extension state (boot, install/uninstall, enable/disable, the
 * disk-sync reconcile, the "Reload skills & MCP" button): for each
 * contributor it PRUNES any previously-deployed `ext-<id>-*` dirs first (so a
 * dropped/renamed slug or a since-revoked permission/disable is cleaned up),
 * then re-deploys from the current manifest if it still qualifies. Bounded to
 * the given contributor list (Rule 5) and never throws.
 */
export async function syncExtensionSkills(
  contributors: readonly SkillContributor[],
  log?: (context: string, err: unknown) => void
): Promise<void> {
  await Promise.all(
    contributors.map(async (ext) => {
      await removeSkillsForExtension(ext.id, log);
      await deploySkillsForExtension(ext, log);
    })
  );
}

export interface PluginSkillContributor {
  id: string;
  rootDir: string;
  enabled: boolean;
  skillsRootPaths: string[];
}

function pluginSkillDirName(pluginId: string, skillName: string): string {
  return `plugin-${slugify(pluginId, 'plugin')}-${slugify(skillName, 'skill')}`;
}

export async function removeSkillsForPlugin(
  pluginId: string,
  log?: (context: string, err: unknown) => void
): Promise<void> {
  try {
    const prefix = `plugin-${slugify(pluginId, 'plugin')}-`;
    const entries = await readdir(SKILLS_ROOT).catch(() => [] as string[]);
    await Promise.all(
      entries
        .filter((name) => name.startsWith(prefix))
        .map((name) =>
          rm(join(SKILLS_ROOT, name), { recursive: true, force: true }).catch((err) =>
            log?.(`removeSkillsForPlugin:${pluginId}`, err)
          )
        )
    );
  } catch (err) {
    log?.(`removeSkillsForPlugin:${pluginId}`, err);
  }
}

async function deploySkillsForPlugin(
  plugin: PluginSkillContributor,
  log?: (context: string, err: unknown) => void
): Promise<Array<{ name: string; ok: boolean }>> {
  try {
    if (!plugin.enabled) return [];
    const names = discoverPluginSkillNames(plugin.rootDir, plugin.skillsRootPaths).slice(
      0,
      SKILLS_PER_EXTENSION_MAX
    );
    const out: Array<{ name: string; ok: boolean }> = [];
    for (const skillName of names) {
      const dirName = pluginSkillDirName(plugin.id, skillName);
      try {
        let src: string | null = null;
        for (const rootRel of plugin.skillsRootPaths) {
          src = await resolveContainedReal(plugin.rootDir, `${rootRel.replace(/\/\*$/, '')}/${skillName}/SKILL.md`);
          if (src) break;
        }
        if (!src) {
          out.push({ name: dirName, ok: false });
          continue;
        }
        const shipped = await readFile(src, 'utf-8');
        const dir = join(SKILLS_ROOT, dirName);
        const file = join(dir, 'SKILL.md');
        let current: string | null = null;
        try {
          current = await readFile(file, 'utf-8');
        } catch {
          current = null;
        }
        if (current !== shipped) {
          await mkdir(dir, { recursive: true });
          const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
          await writeFile(tmp, shipped, 'utf-8');
          await rename(tmp, file);
        }
        out.push({ name: dirName, ok: true });
      } catch (err) {
        log?.(`deploySkillsForPlugin:${plugin.id}`, err);
        out.push({ name: dirName, ok: false });
      }
    }
    return out;
  } catch (err) {
    log?.(`deploySkillsForPlugin:${plugin.id}`, err);
    return [];
  }
}

export async function syncPluginSkills(
  contributors: readonly PluginSkillContributor[],
  log?: (context: string, err: unknown) => void
): Promise<void> {
  await Promise.all(
    contributors.map(async (plugin) => {
      await removeSkillsForPlugin(plugin.id, log);
      await deploySkillsForPlugin(plugin, log);
    })
  );
}
