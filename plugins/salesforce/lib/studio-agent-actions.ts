/**
 * One-click agent requests offered on an Agent Script file (mirrors
 * plugins/design-docs src/shared/agent-actions.ts). Isomorphic: the rail shows
 * the chips, the server turns the chosen one into the opening prompt.
 */
import type { StudioComment, StudioDiagnostic, StudioViewState, ThreadRole } from './studio-contract.js';

export interface StudioAgentAction {
  id: string;
  label: string;
  description: string;
  /** Role the spawned thread gets in the linked-threads list. */
  role: ThreadRole;
  instruction: string;
}

export const MAX_STUDIO_PROMPT_LENGTH = 4000;
export const MAX_STUDIO_REQUEST_LENGTH = 1500;

export const STUDIO_AGENT_ACTIONS: readonly StudioAgentAction[] = [
  { id: 'review', label: 'Review', description: 'Critical review with anchored comments', role: 'reviewer',
    instruction: 'Review this agent critically, as a senior Agentforce engineer would. Leave one review comment per issue (sf_workbench comments.add with an exact quote) covering topic routing gaps, ambiguous instructions, unsafe actions and missing guardrails. Do not rewrite the file yourself. Finish with a short summary of the most important issues.' },
  { id: 'fix-problems', label: 'Fix problems', description: 'Resolve the current diagnostics', role: 'editor',
    instruction: 'Fix the compiler/lint problems listed below. Propose the fix with sf_workbench ui.command editor.proposeEdit so the user can accept or reject each hunk, and keep every change minimal.' },
  { id: 'address-comments', label: 'Address comments', description: 'Apply the open review feedback', role: 'editor',
    instruction: 'Address every open review comment on this agent: propose the edits each one asks for (or explain why not), then resolve each comment with sf_workbench comments.resolve and a one-line note describing what changed.' },
  { id: 'write-scenarios', label: 'Write scenarios', description: 'Draft test scenarios for the agent', role: 'tester',
    instruction: 'Write a scenario suite for this agent: happy paths, topic-routing edge cases and refusal cases, each with utterances and expectations (topic, actions, contains). Save it with sf_workbench studio.suites.save and run it in Preview when you can.' },
  { id: 'explain-selection', label: 'Explain selection', description: 'Explain the selected lines', role: 'assistant',
    instruction: 'Explain what the selected lines (or the line under the cursor) do, which topics and actions they affect, and anything risky about them. Do not change the file.' },
  { id: 'generate-action', label: 'Generate action', description: 'Add an Apex or Flow action', role: 'author',
    instruction: 'Design and add an action this agent is missing: write the Apex invocable method or Flow, then wire it into the right topic of the .agent file with a clear description, inputs and outputs.' },
  { id: 'harden-guardrails', label: 'Harden guardrails', description: 'Tighten scope, refusals and safety', role: 'editor',
    instruction: 'Harden this agent: tighten topic scope, add explicit refusal and escalation instructions, require confirmation before destructive actions and guard against prompt injection. Propose the edits with sf_workbench ui.command editor.proposeEdit.' }
];

export function studioActionById(id: unknown): StudioAgentAction | null {
  return STUDIO_AGENT_ACTIONS.find(action => action.id === id) ?? null;
}

/** Link role for a thread started with `actionId` (free-form requests are plain assistants). */
export function roleForAction(actionId: string | undefined): ThreadRole {
  return (actionId ? studioActionById(actionId)?.role : undefined) ?? 'assistant';
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text);
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

export function formatDiagnostics(diagnostics: readonly StudioDiagnostic[], limit = 20): string[] {
  return diagnostics.slice(0, limit).map(d => `- ${d.severity} L${d.line}:${d.column}${d.code ? ` [${d.code}]` : ''} ${clip(oneLine(d.message), 160)}`);
}

export function formatComments(comments: readonly StudioComment[], limit = 12): string[] {
  return comments.slice(0, limit).map(c => `- ${c.id} L${c.line}${c.endLine !== c.line ? `-${c.endLine}` : ''} "${clip(oneLine(c.quote), 80)}": ${clip(oneLine(c.body), 200)}`);
}

export function buildStudioPrompt(args: {
  path: string;
  view?: Pick<StudioViewState, 'cursor' | 'selection' | 'dirty' | 'tool' | 'sha256'> | null;
  action?: StudioAgentAction | null;
  prompt?: string;
  comments?: readonly StudioComment[];
  diagnostics?: readonly StudioDiagnostic[];
}): string {
  const { path, view, action } = args;
  const request = [action?.instruction, args.prompt?.trim() ? clip(args.prompt.trim(), MAX_STUDIO_REQUEST_LENGTH) : ''].filter(Boolean).join('\n\n');
  const head = `You are working on the Agentforce agent script "${path}" in the Salesforce Studio.`;
  const facts: string[] = [];
  if (view?.dirty) facts.push('The user has unsaved edits in the editor; call sf_workbench view.state for the live state.');
  if (view?.selection) facts.push(`Selected lines ${view.selection.startLine}-${view.selection.endLine}:\n${clip(view.selection.text, 600)}`);
  else if (view?.cursor) facts.push(`Cursor at line ${view.cursor.line}.`);
  if (args.diagnostics?.length) facts.push(`Problems:\n${formatDiagnostics(args.diagnostics).join('\n')}`);
  if (args.comments?.length) facts.push(`Open comments:\n${formatComments(args.comments).join('\n')}`);
  const tail = `Read the file with sf_workbench files.read before changing it. Prefer proposing edits so the user can review them live. When you finish, summarise what you did and end with ::sf-agent{path="${path.replace(/["\\\r\n]/g, '')}"} on its own line.`;
  const fixed = [head, tail].join('\n\n');
  const budget = Math.max(0, MAX_STUDIO_PROMPT_LENGTH - fixed.length - 8);
  // Request first, then context, trimmed to fit so the closing instruction is never cut.
  const body = clip([request, ...facts].filter(Boolean).join('\n\n'), budget);
  return [head, body, tail].filter(Boolean).join('\n\n');
}
