import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/**
 * Rule 6 guard for the skill-provider registry (source-text scan, no execution).
 *
 * Concrete agent-tool ids (`'claude-code'`, `'cursor'`) must live ONLY in the
 * provider descriptors + the registry (`src/main/skills/`). The generic skill
 * ORCHESTRATOR (`src/main/skills.ts`) and the renderer's skills UI must stay
 * tool-agnostic — they iterate `SKILL_PROVIDERS` / read the entry's own `tool` +
 * `toolLabel`, never branch on a hardcoded id. A reintroduced literal there is
 * the #1 way the registry indirection silently rots (a new tool added to the
 * registry but a stale `=== 'cursor'` branch elsewhere quietly disagreeing).
 *
 * Style mirrors `src/shared/__tests__/launch-provider.guard.test.ts`: strip
 * comments so we scan CODE not prose, then assert the tool-id literals are
 * absent from the tool-agnostic seams.
 *
 * NOTE the scope is deliberately narrow — `'cursor'` legitimately appears across
 * the renderer as the "Open in Cursor" editor-opener target, and `'claude-code'`
 * lives in the harness launch-provider. This guard only polices the files that
 * are contractually tool-agnostic.
 */

const SRC_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** Files that MUST NOT name a concrete tool id in code. */
const TOOL_AGNOSTIC_FILES = [
  'main/skills.ts',
  'renderer/components/SkillsPanel.tsx',
  'renderer/components/ProjectSkillsView.tsx'
];

/** The concrete tool-id literals, quoted (single or double). */
const TOOL_ID_LITERALS = [/(['"])claude-code\1/, /(['"])cursor\1/];

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('Rule 6 — concrete skill-tool ids live only in skills/ provider+registry', () => {
  it('has no hardcoded tool-id literal in the tool-agnostic orchestrator / UI', () => {
    const offenders: string[] = [];
    for (const rel of TOOL_AGNOSTIC_FILES) {
      const code = stripComments(readFileSync(join(SRC_ROOT, rel), 'utf8'));
      code.split('\n').forEach((line, i) => {
        for (const re of TOOL_ID_LITERALS) {
          if (re.test(line)) offenders.push(`src/${rel}:${i + 1} — ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      offenders.length === 0
        ? ''
        : `A concrete tool id leaked into a tool-agnostic skills file. Read the ` +
            `entry's own tool/toolLabel or iterate SKILL_PROVIDERS instead:\n` +
            offenders.map((o) => `  - ${o}`).join('\n')
    ).toEqual([]);
  });
});
