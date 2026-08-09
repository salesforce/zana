// Build the first-turn prompt for an agent spawned to pick up a parked
// follow-up (the "Spawn agent" button on a FollowUpRow). The prompt carries the
// follow-up's full context — title, kind, and detail body — and instructs the
// agent to close the loop by resolving the record via the `followup_resolve`
// MCP tool when it's done. Extracted + pure so it can be unit-tested without
// mounting the panel, and so the launcher and any future caller agree on wording.
import type { FollowUp, FollowUpKind } from '@shared/types';

/** Kind → the framing verb used in the prompt header. */
const KIND_FRAMING: Record<FollowUpKind, string> = {
  question: 'a parked question',
  decision: 'a go/no-go decision',
  note: 'a parked note'
};

/**
 * Compose the initial prompt for a follow-up spawn. The agent lands in the
 * follow-up's own project (so its `followup_*` MCP tools are scoped to it), and
 * the closing instruction references the record by id so the agent can resolve
 * or dismiss it once the work is done — closing the human-in-the-loop cycle.
 */
export function buildFollowUpPrompt(followUp: FollowUp): string {
  const framing = KIND_FRAMING[followUp.kind] ?? 'a parked follow-up';
  const lines: string[] = [
    `You're picking up ${framing} that was left for a human in this project. Please act on it.`,
    '',
    `## ${followUp.title}`
  ];
  if (followUp.detail?.trim()) {
    lines.push('', followUp.detail.trim());
  }
  lines.push(
    '',
    '---',
    `When you have acted on or answered this, close the loop: call the \`followup_resolve\` MCP tool with id \`${followUp.id}\`, status \`"resolved"\` (or \`"dismissed"\` if it turned out to be moot), and a one-line resolution recording the outcome. If you need a human decision before you can proceed, leave it open and explain what you need.`
  );
  return lines.join('\n');
}

/**
 * Compose the seed prompt for the FRESH-spawn tier of the answer loop: there is
 * no live agent and no resumable transcript, so a new agent is started carrying
 * BOTH the original parked question AND the human's answer, and asked to act on
 * that answer. Distinct from {@link buildFollowUpPrompt} (which spawns an agent
 * to figure the question out) — here the human has already decided, so the agent
 * executes the decision rather than re-deriving it. The closing instruction
 * still asks the agent to `followup_resolve` the record when done.
 */
export function buildFollowUpAnswerPrompt(followUp: FollowUp, answer: string): string {
  const framing = KIND_FRAMING[followUp.kind] ?? 'a parked follow-up';
  const lines: string[] = [
    `A human answered ${framing} that was parked for them in this project. Act on their answer.`,
    '',
    `## ${followUp.title}`
  ];
  if (followUp.detail?.trim()) {
    lines.push('', followUp.detail.trim());
  }
  lines.push('', '## The human answered', '', answer.trim());
  lines.push(
    '',
    '---',
    `Proceed on the basis of that answer. When you have acted on it, close the loop: call the \`followup_resolve\` MCP tool with id \`${followUp.id}\`, status \`"resolved"\`, and a one-line resolution recording what you did. If the answer leaves you genuinely unable to proceed, leave it open and explain what you still need.`
  );
  return lines.join('\n');
}

/** A short, tab-friendly title for the spawned agent, derived from the follow-up. */
export function followUpAgentTitle(followUp: FollowUp): string {
  const t = followUp.title.trim();
  return t.length > 48 ? `${t.slice(0, 47)}…` : t;
}
