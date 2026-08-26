import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentRuntimeSkillRoot } from '@zana-ai/zcc-agent-runtime';

export function injectedSkillRootsFile(dataDir: string): string {
  return join(dataDir, 'injected-skill-roots.json');
}

function skillDescriptionFromFrontmatter(body: string, fallback: string): string {
  const fence = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fence) return fallback;
  const desc = fence[1].match(/^description:\s*(.+)$/m);
  return desc?.[1]?.trim() || fallback;
}

function discoverSkills(root: string): Array<{ name: string; description: string }> {
  if (!existsSync(root)) return [];
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const skills: Array<{ name: string; description: string }> = [];
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
    out.push({
      id: `${id}:acp`,
      providerId: 'acp',
      skillDirectoryRootPath: root,
      skills
    });
  }
  return out;
}

export function loadRuntimeSkillRoots(dataDir: string): AgentRuntimeSkillRoot[] {
  return expandDirectoryRootsToRuntimeSkillRoots(readInjectedSkillDirectoryRoots(dataDir));
}
