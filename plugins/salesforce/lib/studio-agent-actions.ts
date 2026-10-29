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
  /** What the user sends, shown in the conversation: `{file}` and `{lines}` are filled in. */
  ask: string;
  /** How the agent should handle it; sent as context, not as the user's message. */
  instruction: string;
}

export const MAX_STUDIO_PROMPT_LENGTH = 4000;
export const MAX_STUDIO_REQUEST_LENGTH = 1500;

export const STUDIO_AGENT_ACTIONS: readonly StudioAgentAction[] = [
  { id: 'review', label: 'Review', description: 'Critical review with anchored comments', role: 'reviewer',
    ask: 'Review {file}.',
    instruction: 'Review this agent critically, as a senior Agentforce engineer would. Leave one review comment per issue (sf_workbench comments.add with an exact quote) covering topic routing gaps, ambiguous instructions, unsafe actions and missing guardrails. Do not rewrite the file yourself. Finish with a short summary of the most important issues.' },
  { id: 'fix-problems', label: 'Fix problems', description: 'Resolve the current diagnostics', role: 'editor',
    ask: 'Fix the problems in {file}.',
    instruction: 'Fix the compiler/lint problems listed below. Propose the fix with sf_workbench ui.command editor.proposeEdit so the user can accept or reject each hunk, and keep every change minimal.' },
  { id: 'address-comments', label: 'Address comments', description: 'Apply the open review feedback', role: 'editor',
    ask: 'Address the open comments on {file}.',
    instruction: 'Address every open review comment on this agent: propose the edits each one asks for (or explain why not), then resolve each comment with sf_workbench comments.resolve and a one-line note describing what changed.' },
  { id: 'write-scenarios', label: 'Write scenarios', description: 'Draft test scenarios for the agent', role: 'tester',
    ask: 'Write test scenarios for {file}.',
    instruction: 'Write a scenario suite for this agent: happy paths, topic-routing edge cases and refusal cases, each with utterances, expectations (topic, actions, contains), and starting contextVariables where needed. Read sf_workbench suites.list first; preserve existing cases and use expectedSha256 when updating. Save it with sf_workbench suites.save and run it in Preview when you can.' },
  { id: 'explain-selection', label: 'Explain selection', description: 'Explain the selected lines', role: 'assistant',
    ask: 'Explain {lines} of {file}.',
    instruction: 'Explain what the selected lines (or the line under the cursor) do, which topics and actions they affect, and anything risky about them. Do not change the file.' },
  { id: 'generate-action', label: 'Generate action', description: 'Add an Apex or Flow action', role: 'author',
    ask: 'Add the action {file} is missing.',
    instruction: 'Design and add an action this agent is missing: write the Apex invocable method or Flow, then wire it into the right topic of the .agent file with a clear description, inputs and outputs.' },
  { id: 'harden-guardrails', label: 'Harden guardrails', description: 'Tighten scope, refusals and safety', role: 'editor',
    ask: 'Harden the guardrails in {file}.',
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

type StudioView = Pick<StudioViewState, 'cursor' | 'selection' | 'dirty' | 'tool' | 'sha256'>;

const fileName = (path: string) => path.split('/').pop() || path;

/** The lines a request is about: the selection, else the cursor line. */
function linesLabel(view?: StudioView | null): string {
  const range = view?.selection ? [view.selection.startLine, view.selection.endLine] : view?.cursor ? [view.cursor.line, view.cursor.line] : null;
  if (!range) return 'the selected lines';
  return range[1] > range[0] ? `lines ${range[0]}-${range[1]}` : `line ${range[0]}`;
}

/** The message the user sends: their own words, else the action's short ask. Context travels separately. */
export function buildStudioRequest(args: { path: string; view?: StudioView | null; action?: StudioAgentAction | null; prompt?: string }): string {
  const own = args.prompt?.trim();
  if (own) return clip(own, MAX_STUDIO_REQUEST_LENGTH);
  const ask = args.action?.ask ?? 'Help me with {file}.';
  return ask.replace('{lines}', linesLabel(args.view)).replace('{file}', fileName(args.path));
}

/**
 * What the Studio knows when the conversation starts, sent as the agent's instructions rather than as
 * the user's message: the file, the selection, the relevant problems and comments, and how to work.
 */
export function buildStudioContext(args: {
  path: string;
  view?: StudioView | null;
  action?: StudioAgentAction | null;
  comments?: readonly StudioComment[];
  diagnostics?: readonly StudioDiagnostic[];
}): string {
  const { path, view, action } = args;
  const head = `This conversation started in the Salesforce Studio, about the Agentforce agent script "${path}". What follows is what the Studio showed when it started; the user does not see it, so do not repeat it back.`;
  const facts: string[] = [];
  if (action) facts.push(`The first message came from the Studio's "${action.label}" action. For that request: ${action.instruction}`);
  if (view?.dirty) facts.push('The user has unsaved edits in the editor; call sf_workbench view.state for the live state.');
  if (view?.selection) facts.push(`Selected lines ${view.selection.startLine}-${view.selection.endLine}:\n${clip(view.selection.text, 600)}`);
  else if (view?.cursor) facts.push(`Cursor at line ${view.cursor.line}.`);
  // A request about some lines only needs the problems on them.
  const range = action?.id === 'explain-selection' && view?.selection ? view.selection : null;
  const diagnostics = range ? (args.diagnostics ?? []).filter(d => d.line <= range.endLine && d.endLine >= range.startLine) : args.diagnostics ?? [];
  if (diagnostics.length) facts.push(`Problems${range ? ' on those lines' : ''}:\n${formatDiagnostics(diagnostics).join('\n')}`);
  if (args.comments?.length) facts.push(`Open comments:\n${formatComments(args.comments).join('\n')}`);
  const tail = `Read the file with sf_workbench files.read before changing it. Prefer proposing edits so the user can review them live. When you finish, summarise what you did and end with ::sf-agent{path="${path.replace(/["\\\r\n]/g, '')}"} on its own line.`;
  const fixed = [head, tail].join('\n\n');
  const budget = Math.max(0, MAX_STUDIO_PROMPT_LENGTH - fixed.length - 8);
  // Trimmed to fit so the closing instruction is never cut.
  const body = clip(facts.join('\n\n'), budget);
  return [head, body, tail].filter(Boolean).join('\n\n');
}
