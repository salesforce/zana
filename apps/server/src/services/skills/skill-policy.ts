import { readFileSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SkillState } from '@zana-ai/zcc-domain/product';

/**
 * Opt-in load policy for skills ZCC injects into every harness (plugin and
 * builtin skill roots). Absent = `on`; only `manual` / `off` are stored. The
 * host daemon reads the same file when it snapshots skill roots for a thread
 * (`apps/host-daemon/src/injected-skill-roots.ts`), so the policy reaches
 * Claude Code, Codex, Pi and ACP alike. Keyed by skill directory name.
 */
export interface SkillPolicyFile {
  version: 1;
  skills: Record<string, Exclude<SkillState, 'on'>>;
}

const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isPolicySkillName(name: unknown): name is string {
  return typeof name === 'string' && SKILL_NAME.test(name) && name !== '__proto__';
}

export function skillPolicyPath(dataDir: string): string {
  return join(dataDir, 'skill-policy.json');
}

export function readSkillPolicy(dataDir: string): Map<string, Exclude<SkillState, 'on'>> {
  const out = new Map<string, Exclude<SkillState, 'on'>>();
  try {
    const parsed = JSON.parse(readFileSync(skillPolicyPath(dataDir), 'utf8')) as { skills?: unknown };
    if (!parsed.skills || typeof parsed.skills !== 'object' || Array.isArray(parsed.skills)) return out;
    for (const [name, state] of Object.entries(parsed.skills as Record<string, unknown>)) {
      if (isPolicySkillName(name) && (state === 'manual' || state === 'off')) out.set(name, state);
    }
  } catch {
    /* missing or malformed policy means everything is on */
  }
  return out;
}

let policyTail: Promise<unknown> = Promise.resolve();

export function setSkillPolicyStates(
  dataDir: string,
  updates: ReadonlyArray<{ name: string; state: SkillState }>
): Promise<void> {
  const valid = updates.filter((row) => isPolicySkillName(row.name));
  if (!valid.length) return Promise.resolve();
  const operation = async () => {
    const current = readSkillPolicy(dataDir);
    for (const { name, state } of valid) {
      if (state === 'on') current.delete(name);
      else current.set(name, state);
    }
    const body: SkillPolicyFile = {
      version: 1,
      skills: Object.fromEntries([...current].sort(([a], [b]) => a.localeCompare(b)))
    };
    await mkdir(dataDir, { recursive: true });
    const destination = skillPolicyPath(dataDir);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true });
    }
  };
  const result = policyTail.then(operation, operation);
  policyTail = result.catch(() => undefined);
  return result;
}
