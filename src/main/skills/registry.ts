/**
 * The skill-provider registry — the single registration seam where concrete
 * agent-tool ids are wired to their discovery/toggle implementations (the
 * `MAIN_MODULES` analogue for skills, Rule 6). Core skill logic (`../skills.ts`)
 * never names a tool; it iterates {@link SKILL_PROVIDERS} and resolves a
 * provider for an entry via {@link providerForEntryId}.
 *
 * Static, boot-time-constant list (Rule 3: providers are stateless value
 * objects — nothing to subscribe or dispose). Adding Codex/Gemini/Windsurf =
 * one new provider object in `skill-provider.ts` + one entry here, zero caller
 * edits.
 */

import type { SkillTool } from '../../shared/types.js';
import {
  claudeCodeSkillProvider,
  cursorSkillProvider,
  type SkillProvider
} from './skill-provider.js';

export const SKILL_PROVIDERS: readonly SkillProvider[] = [
  claudeCodeSkillProvider,
  cursorSkillProvider
];

/** The default tool for a bare (tool-less) id — the historical Claude ids. */
export const DEFAULT_SKILL_TOOL: SkillTool = claudeCodeSkillProvider.id;

export function providerForTool(tool: SkillTool): SkillProvider | undefined {
  return SKILL_PROVIDERS.find((p) => p.id === tool);
}

/**
 * Build the entry id for a discovered unit. Claude Code keeps its historical
 * 2-part `${source}:${qualifiedName}` id (so existing bundles + skillOverrides
 * references stay valid); every other tool prefixes its id with the tool so
 * ids stay globally unique.
 */
export function entryId(tool: SkillTool, source: string, qualifiedName: string): string {
  return tool === DEFAULT_SKILL_TOOL
    ? `${source}:${qualifiedName}`
    : `${tool}:${source}:${qualifiedName}`;
}

/**
 * Resolve the provider that owns an entry id. A bare 2-part id (no registered
 * tool prefix) resolves to the default (Claude) provider — this is what keeps
 * old bundle ids working. A 3-part id whose first segment is a registered tool
 * resolves to that provider.
 */
export function providerForEntryId(id: string): SkillProvider | undefined {
  const first = id.split(':', 1)[0];
  const byTool = providerForTool(first);
  if (byTool && byTool.id !== DEFAULT_SKILL_TOOL) return byTool;
  return providerForTool(DEFAULT_SKILL_TOOL);
}
