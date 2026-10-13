import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SKILL_STATES, type SkillEntry, type SkillState } from '@zana-ai/zcc-domain/product';
import {
  BUILTIN_SKILL_OWNER,
  injectedSkillRootsPath,
  readInjectedSkillDirectoryRoots
} from '../../plugins/injected-skill-roots.js';
import { isPolicySkillName, readSkillPolicy } from './skill-policy.js';

export const INJECTED_SKILL_TOOL = 'zcc';
const INJECTED_ID_PREFIX = `${INJECTED_SKILL_TOOL}:`;
const MAX_SKILLS = 512;

export function isInjectedSkillId(id: string): boolean {
  return id.startsWith(INJECTED_ID_PREFIX);
}

/** `zcc:<owner>/<name>` → `<name>`, or null when the id is not a valid injected id. */
export function injectedSkillNameFromId(id: string): string | null {
  if (!isInjectedSkillId(id)) return null;
  const segments = id.slice(INJECTED_ID_PREFIX.length).split('/');
  const name = segments.pop();
  if (!segments.length || segments.some((part) => !part || part === '.' || part === '..')) return null;
  return isPolicySkillName(name) ? name : null;
}

function readRootOwners(dataDir: string): Record<string, string> {
  try {
    const parsed = JSON.parse(readFileSync(injectedSkillRootsPath(dataDir), 'utf8')) as {
      rootOwners?: unknown;
    };
    const owners = parsed.rootOwners;
    if (!owners || typeof owners !== 'object' || Array.isArray(owners)) return {};
    return Object.fromEntries(
      Object.entries(owners as Record<string, unknown>).filter(
        (pair): pair is [string, string] => typeof pair[1] === 'string' && pair[1].length > 0
      )
    );
  } catch {
    return {};
  }
}

function frontmatter(body: string): { description?: string; disableModelInvocation: boolean } {
  const fence = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fence) return { disableModelInvocation: false };
  const description = fence[1].match(/^description:\s*(.+)$/m)?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2');
  const disableModelInvocation = /^disable-model-invocation:\s*true\s*$/m.test(fence[1]);
  return { ...(description ? { description } : {}), disableModelInvocation };
}

/**
 * Skills ZCC injects into every harness session (installed plugins, builtin
 * and generated skills), with their opt-in load policy. Local primary host
 * only: the manifest and policy live in this machine's data directory.
 */
export function listInjectedSkillEntries(dataDir: string, hostId?: string): SkillEntry[] {
  const owners = readRootOwners(dataDir);
  const policy = readSkillPolicy(dataDir);
  const out: SkillEntry[] = [];
  const seen = new Set<string>();
  for (const root of readInjectedSkillDirectoryRoots(dataDir)) {
    const owner = owners[root] ?? BUILTIN_SKILL_OWNER;
    let names: string[];
    try {
      names = readdirSync(root).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      if (out.length >= MAX_SKILLS) return out;
      if (!isPolicySkillName(name)) continue;
      const dir = join(root, name);
      let body: string;
      try {
        // statSync follows the builtin staging symlinks.
        if (!statSync(dir).isDirectory()) continue;
        body = readFileSync(join(dir, 'SKILL.md'), 'utf8');
      } catch {
        continue;
      }
      const id = `${INJECTED_ID_PREFIX}${owner}/${name}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const parsed = frontmatter(body);
      // An author-level `disable-model-invocation` already pins the skill to manual.
      const states: readonly SkillState[] = parsed.disableModelInvocation
        ? ['manual', 'off']
        : SKILL_STATES;
      const stored = policy.get(name);
      const state: SkillState = stored ?? (parsed.disableModelInvocation ? 'manual' : 'on');
      out.push({
        id,
        name,
        tool: INJECTED_SKILL_TOOL,
        toolLabel: 'All harnesses',
        allHarnesses: true,
        source: 'plugin',
        pluginName: owner,
        path: dir,
        kind: 'skill',
        revealable: false,
        ...(hostId ? { hostId } : {}),
        disableModelInvocation: parsed.disableModelInvocation,
        ...(parsed.description ? { description: parsed.description } : {}),
        toggle: { supported: true, enabled: state !== 'off', state, states },
        enabled: state !== 'off'
      });
    }
  }
  return out;
}
