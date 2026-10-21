import { titleFromObjective } from '@zana-ai/zcc-domain';

/** Enough of an attached plan for the namer to see its purpose, without sending the whole file. */
export const TEAM_NAMER_SOURCE_EXCERPT_CHARS = 1_500;

const MENTION = /(^|[\s(])@[^\s`'"),;:@]+/g;

/**
 * What the Squad namer sees. A goal that only mentions an attached plan (`@plan.md`) gives the
 * model nothing to name, so it answers as if asked to read the file ("Need Permission To Read").
 * The first attached source's opening text goes with the goal, and its first heading is the
 * fallback when the goal has no words of its own.
 */
export function teamRunNamerInput(goal: string, sourceTexts: readonly (string | undefined)[] = []): { prompt: string; fallbackTitle: string } {
  const source = sourceTexts.find((text) => text?.trim())?.trim() ?? '';
  const excerpt = source.slice(0, TEAM_NAMER_SOURCE_EXCERPT_CHARS);
  const heading = /^#{1,6}[ \t]+(.+?)[ \t#]*$/m.exec(source)?.[1] ?? '';
  return {
    prompt: excerpt ? `${goal.trim()}\n\nAttached plan:\n${excerpt}` : goal,
    fallbackTitle: titleFromObjective(goal.replace(MENTION, '$1')) || titleFromObjective(heading) || 'Team run'
  };
}
