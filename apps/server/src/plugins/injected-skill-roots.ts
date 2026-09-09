import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatedSkillsRootPath } from './plugin-commands-skill.js';
import { tryResolveContainedPath } from './plugin-skills.js';

export interface InjectedSkillRootManifest {
  directoryRoots: string[];
}

/**
 * Always-on skills shipped next to this module (`builtin-skills/<name>/SKILL.md`).
 * Vite bundles this file into `out/main/chunks`, so `import.meta.url` is no
 * longer a sibling of the markdown — walk candidates the same way
 * `defaultBundledRoot` finds `plugins/`.
 */
export function builtinSkillsRootPath(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const resourcesPath =
    typeof process.resourcesPath === 'string' && process.resourcesPath.length > 0
      ? process.resourcesPath
      : null;
  const candidates = [
    join(moduleDir, 'builtin-skills'),
    // Compiled into out/main/chunks — walk back to the source tree.
    join(moduleDir, '../../../../apps/server/src/plugins/builtin-skills'),
    join(moduleDir, '../../../apps/server/src/plugins/builtin-skills'),
    join(process.cwd(), 'apps/server/src/plugins/builtin-skills'),
    resourcesPath ? join(resourcesPath, 'builtin-skills') : null
  ].filter((dir): dir is string => !!dir);
  return candidates.find((dir) => existsSync(dir)) ?? candidates[0]!;
}

export function injectedBuiltinSkillsStagingPath(dataDir: string): string {
  return join(dataDir, 'injected-builtin-skills');
}

/**
 * Builtin skill folders to inject for the current operator opt-outs.
 * Master-off returns nothing. A partial per-skill opt-out stages a filtered
 * copy (symlink, copy fallback) so host-daemon discovery still sees
 * `<root>/<name>/SKILL.md`. Subsequent launches only — callers rewrite the
 * injected-skill-roots manifest after config changes.
 */
export function selectBuiltinSkillDirectoryRoots(args: {
  dataDir: string;
  injectBundledSkills?: boolean;
  disabledBundledSkills?: readonly string[];
}): string[] {
  const staging = injectedBuiltinSkillsStagingPath(args.dataDir);
  const clearStaging = () => {
    if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
  };
  if (args.injectBundledSkills === false) {
    clearStaging();
    return [];
  }
  const src = builtinSkillsRootPath();
  if (!existsSync(src)) {
    clearStaging();
    return [];
  }
  const discovered = discoverSkillsInRoot(src);
  const disabled = new Set(
    (args.disabledBundledSkills ?? []).filter((name) => typeof name === 'string' && name.length > 0)
  );
  const enabled = discovered.filter((skill) => !disabled.has(skill.name));
  if (enabled.length === 0) {
    clearStaging();
    return [];
  }
  if (enabled.length === discovered.length) {
    clearStaging();
    return [src];
  }
  clearStaging();
  mkdirSync(staging, { recursive: true });
  for (const skill of enabled) {
    const from = join(src, skill.name);
    const to = join(staging, skill.name);
    try {
      symlinkSync(from, to, 'dir');
    } catch {
      cpSync(from, to, { recursive: true });
    }
  }
  return [staging];
}

export function injectedSkillRootsPath(dataDir: string): string {
  return join(dataDir, 'injected-skill-roots.json');
}

export function collectPluginSkillDirectoryRoots(args: {
  rootDir: string;
  relativeRoots: readonly string[];
  extraRoots?: readonly string[];
}): string[] {
  const out: string[] = [];
  for (const rel of args.relativeRoots) {
    const resolved = tryResolveContainedPath(args.rootDir, rel.replace(/\/\*$/, ''));
    if (resolved) out.push(resolved);
  }
  for (const extra of args.extraRoots ?? []) {
    if (typeof extra === 'string' && extra.length > 0 && existsSync(extra)) out.push(extra);
  }
  return out;
}

export function writeInjectedSkillRootManifest(
  dataDir: string,
  directoryRoots: readonly string[]
): void {
  mkdirSync(dataDir, { recursive: true });
  const unique = [...new Set(directoryRoots.filter((root) => existsSync(root)))].sort();
  writeFileSync(
    injectedSkillRootsPath(dataDir),
    `${JSON.stringify({ directoryRoots: unique } satisfies InjectedSkillRootManifest)}\n`
  );
}

export function readInjectedSkillDirectoryRoots(dataDir: string): string[] {
  const roots = new Set<string>();
  const generated = generatedSkillsRootPath(dataDir);
  if (existsSync(generated)) roots.add(generated);
  try {
    const parsed = JSON.parse(readFileSync(injectedSkillRootsPath(dataDir), 'utf8')) as {
      directoryRoots?: unknown;
    };
    if (Array.isArray(parsed.directoryRoots)) {
      for (const root of parsed.directoryRoots) {
        if (typeof root === 'string' && existsSync(root)) roots.add(root);
      }
      return [...roots];
    }
  } catch {
    /* missing or malformed manifest falls back to the full builtin tree */
  }
  const builtin = builtinSkillsRootPath();
  if (existsSync(builtin)) roots.add(builtin);
  return [...roots];
}

export interface DiscoveredSkill {
  name: string;
  description: string;
}

function skillDescriptionFromFrontmatter(body: string, fallback: string): string {
  const fence = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fence) return fallback;
  const desc = fence[1].match(/^description:\s*(.+)$/m);
  return desc?.[1]?.trim() || fallback;
}

export function discoverSkillsInRoot(root: string): DiscoveredSkill[] {
  if (!existsSync(root)) return [];
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const skills: DiscoveredSkill[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillFile = join(root, entry.name, 'SKILL.md');
    if (!existsSync(skillFile)) continue;
    let description = entry.name;
    try {
      description = skillDescriptionFromFrontmatter(readFileSync(skillFile, 'utf8'), entry.name);
    } catch {
      /* keep the directory name */
    }
    skills.push({ name: entry.name, description });
  }
  return skills;
}
