import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentRuntimeSkillRoot } from '@zana-ai/zcc-agent-runtime';
import { discoverNativeSkillRoots } from './native-skill-discovery.js';

export function injectedSkillRootsFile(dataDir: string): string {
  return join(dataDir, 'injected-skill-roots.json');
}

/** Main stamps these paths after confining filtered builtin symlinks to its own bundle. */
export function readBuiltinSkillTargets(dataDir: string): ReadonlySet<string> {
  try {
    const parsed = JSON.parse(readFileSync(injectedSkillRootsFile(dataDir), 'utf8'));
    return new Set(Array.isArray(parsed.builtinSkillTargets)
      ? parsed.builtinSkillTargets.filter((value: unknown) => typeof value === 'string').slice(0, 64) : []);
  } catch { return new Set(); }
}

export type InjectedSkillPolicyState = 'manual' | 'off';
const BUILTIN_SKILL_OWNER = 'built-in';

/** Main-authorized ids for one unattended session. Never accept paths here. */
export interface AutomatedSkillSelection {
  skillIds: readonly string[];
}

const POLICY_SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * Operator opt-outs written by the product server (`skill-policy.json`).
 * Absent = on. `off` drops the skill from snapshots; `manual` keeps it
 * invocable as `/name` but hides it from the model's skill listing.
 */
export function readInjectedSkillPolicy(dataDir: string): ReadonlyMap<string, InjectedSkillPolicyState> {
  const out = new Map<string, InjectedSkillPolicyState>();
  try {
    const parsed = JSON.parse(readFileSync(join(dataDir, 'skill-policy.json'), 'utf8'));
    const skills = parsed?.skills;
    if (!skills || typeof skills !== 'object' || Array.isArray(skills)) return out;
    for (const [name, state] of Object.entries(skills as Record<string, unknown>)) {
      if (POLICY_SKILL_NAME.test(name) && name !== '__proto__' && (state === 'manual' || state === 'off')) out.set(name, state);
    }
  } catch { /* everything on */ }
  return out;
}

/** Claude Code and Pi honour this frontmatter key: keep `/name`, hide from the model. */
export function withModelInvocationDisabled(body: string): string {
  const fence = body.match(/^---(\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!fence) return `---\ndisable-model-invocation: true\n---\n${body}`;
  const [whole, eol, head, close] = fence;
  const next = /^disable-model-invocation:.*$/m.test(head)
    ? head.replace(/^disable-model-invocation:.*$/m, 'disable-model-invocation: true')
    : `${head}${eol}disable-model-invocation: true`;
  return `---${eol}${next}${close}${body.slice(whole.length)}`;
}

/** Codex reads implicit-invocation policy from `<skill>/agents/openai.yaml`. */
export const CODEX_MANUAL_SKILL_POLICY = 'policy:\n  allow_implicit_invocation: false\n';

function skillDescriptionFromFrontmatter(body: string, fallback: string): string {
  const fence = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fence) return fallback;
  const desc = fence[1].match(/^description:\s*(.+)$/m);
  return desc?.[1]?.trim() || fallback;
}

type DiscoveredSkill = { name: string; description: string; manual: boolean };

function isAuthorizedBuiltinSymlink(path: string, builtinTargets?: ReadonlySet<string>): boolean {
  if (!builtinTargets) return false;
  try {
    return builtinTargets.has(realpathSync(path));
  } catch {
    return false;
  }
}

function discoverSkills(root: string, builtinTargets?: ReadonlySet<string>): DiscoveredSkill[] {
  if (!existsSync(root)) return [];
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const skills: DiscoveredSkill[] = [];
  for (const entry of entries) {
    const skillPath = join(root, entry.name);
    if (!entry.isDirectory() && (!entry.isSymbolicLink() || !isAuthorizedBuiltinSymlink(skillPath, builtinTargets))) continue;
    const skillFile = join(root, entry.name, 'SKILL.md');
    if (!existsSync(skillFile)) continue;
    let description = entry.name;
    let manual = false;
    try {
      const body = readFileSync(skillFile, 'utf8');
      description = skillDescriptionFromFrontmatter(body, entry.name);
      const fence = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      manual = !!fence && /^disable-model-invocation:\s*true\s*$/m.test(fence[1]);
    } catch {
      /* keep the directory name */
    }
    skills.push({ name: entry.name, description, manual });
  }
  return skills;
}

export function readInjectedSkillDirectoryRoots(dataDir: string): string[] {
  const generated = join(dataDir, 'skills-generated');
  const roots = new Set<string>();
  if (existsSync(generated)) roots.add(generated);
  try {
    const parsed = JSON.parse(readFileSync(injectedSkillRootsFile(dataDir), 'utf8')) as {
      directoryRoots?: unknown;
    };
    if (Array.isArray(parsed.directoryRoots)) {
      for (const root of parsed.directoryRoots) {
        if (typeof root === 'string' && existsSync(root)) roots.add(root);
      }
    }
  } catch {
    /* well-known dirs are enough when the manifest is absent */
  }
  return [...roots];
}

/**
 * Resolve main-authorized skill ids against the daemon's current confined
 * manifest. An automated session gets no implicit fallback to the full catalog.
 */
export function resolveAutomatedSkillSelection(
  dataDir: string,
  selection: AutomatedSkillSelection
): ReadonlyMap<string, ReadonlySet<string>> {
  if (selection.skillIds.length > 64) throw new Error('Too many automated skill ids');
  const skillIds = [...selection.skillIds].sort();
  const requested = new Set(skillIds);
  if (requested.size !== skillIds.length) throw new Error('Automated skill ids must be unique');
  const roots = readInjectedSkillDirectoryRoots(dataDir);
  const builtinTargets = readBuiltinSkillTargets(dataDir);
  const owners = new Map<string, string>();
  try {
    const parsed = JSON.parse(readFileSync(injectedSkillRootsFile(dataDir), 'utf8')) as { rootOwners?: unknown };
    if (parsed.rootOwners && typeof parsed.rootOwners === 'object' && !Array.isArray(parsed.rootOwners)) {
      for (const [root, owner] of Object.entries(parsed.rootOwners)) {
        if (typeof owner === 'string') owners.set(root, owner);
      }
    }
  } catch { /* manifest absence means no selected ids can resolve */ }
  const candidates = new Map<string, Array<{ root: string; name: string }>>();
  const policy = readInjectedSkillPolicy(dataDir);
  for (const root of roots) {
    const owner = owners.get(root) ?? BUILTIN_SKILL_OWNER;
    for (const skill of discoverSkills(root, builtinTargets)) {
      const id = `zcc:${owner}/${skill.name}`;
      if (requested.has(id)) {
        const matches = candidates.get(id) ?? [];
        matches.push({ root, name: skill.name });
        candidates.set(id, matches);
      }
    }
  }
  const resolved = new Map<string, Set<string>>();
  for (const id of skillIds) {
    const matches = candidates.get(id) ?? [];
    if (matches.length === 0) throw new Error(`Unknown automated skill id: ${id}`);
    if (matches.length !== 1) throw new Error(`Ambiguous automated skill id: ${id}`);
    const match = matches[0]!;
    if (policy.get(match.name) === 'off') throw new Error(`Automated skill is disabled: ${id}`);
    const selected = resolved.get(match.root) ?? new Set<string>();
    selected.add(match.name);
    resolved.set(match.root, selected);
  }
  return resolved;
}

/**
 * Expand skill-folder parents into per-provider AgentRuntime skill roots.
 * Each directory is a folder of `<name>/SKILL.md` trees.
 */
export function expandDirectoryRootsToRuntimeSkillRoots(
  directoryRoots: readonly string[]
): AgentRuntimeSkillRoot[] {
  const out: AgentRuntimeSkillRoot[] = [];
  for (const [index, root] of directoryRoots.entries()) {
    if (!existsSync(root)) continue;
    const id = `injected-${index}`;
    const skills = discoverSkills(root);
    out.push({
      id: `${id}:claude-code`,
      providerId: 'claude-code',
      localPluginPath: root
    });
    out.push({
      id: `${id}:codex`,
      providerId: 'codex',
      skillDirectoryRootPath: root
    });
    out.push({
      id: `${id}:pi`,
      providerId: 'pi',
      skillDirectoryRootPath: root
    });
    // ACP has no native skills: ZCC lists them in the session instructions, so manual ones stay out.
    out.push({
      id: `${id}:acp`,
      providerId: 'acp',
      skillDirectoryRootPath: root,
      skills: skills.filter((skill) => !skill.manual).map(({ name, description }) => ({ name, description }))
    });
  }
  return out;
}

export function loadRuntimeSkillRoots(
  dataDir: string,
  nativeRoots: readonly AgentRuntimeSkillRoot[] = discoverNativeSkillRoots()
): AgentRuntimeSkillRoot[] {
  return [
    ...expandDirectoryRootsToRuntimeSkillRoots(readInjectedSkillDirectoryRoots(dataDir)),
    ...nativeRoots
  ];
}

/** Stable hash of injected skill directory roots + discovered skill names + load policy. */
export function hashInjectedSkillCatalog(dataDir: string): string {
  const roots = readInjectedSkillDirectoryRoots(dataDir).slice().sort();
  const payload = roots.map((root) => ({
    root,
    skills: discoverSkills(root).map((skill) => `${skill.name}:${skill.description}`).sort()
  }));
  const policy = [...readInjectedSkillPolicy(dataDir)].sort(([a], [b]) => a.localeCompare(b));
  return createHash('sha256').update(JSON.stringify({ payload, policy })).digest('hex');
}
