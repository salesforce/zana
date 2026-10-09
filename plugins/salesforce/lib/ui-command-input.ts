import { isProposeEditInput, STUDIO_ENGINES, type StudioEngine } from './studio-contract.js';

/** Isomorphic input validation for the Studio UI verbs (server request() and the renderer executor share it). */
export const STUDIO_UI_COMMANDS = ['editor.proposeEdit', 'preview.start', 'preview.send', 'trace.focus', 'graph.focus', 'layout.set'] as const;
export type StudioUiCommandName = typeof STUDIO_UI_COMMANDS[number];
export const PREVIEW_TEXT_MAX = 4000;
const posInt = (value: unknown) => Number.isInteger(value) && Number(value) >= 0;
const unknownKeys = (input: Record<string, unknown>, allowed: string[]) => Object.keys(input).find(key => !allowed.includes(key));

/** Returns a human-readable problem, or undefined when the input is valid (or the command has no extra rules). */
export function validateUiCommandInput(command: string, input: Record<string, unknown>): string | undefined {
  switch (command) {
    case 'editor.proposeEdit':
      return isProposeEditInput(input) ? undefined : 'Provide path, a 64-hex expectedSha256, a summary, and exactly one of content (<=180k chars) or 1-50 edits.';
    case 'preview.start':
      if (unknownKeys(input, ['engine'])) return 'preview.start accepts only engine.';
      return input.engine === undefined || STUDIO_ENGINES.includes(input.engine as StudioEngine) ? undefined : 'engine must be rehearse, simulate or live.';
    case 'preview.send':
      if (unknownKeys(input, ['text', 'engine'])) return 'preview.send accepts only text and engine.';
      if (input.engine !== undefined && !STUDIO_ENGINES.includes(input.engine as StudioEngine)) return 'engine must be rehearse, simulate or live.';
      return typeof input.text === 'string' && input.text.trim() && input.text.length <= PREVIEW_TEXT_MAX ? undefined : `Provide text (1-${PREVIEW_TEXT_MAX} characters).`;
    case 'trace.focus':
      if (unknownKeys(input, ['runId', 'turn', 'step'])) return 'trace.focus accepts runId, turn and step.';
      if (input.runId !== undefined && (typeof input.runId !== 'string' || !input.runId || input.runId.length > 200)) return 'runId must be a short string.';
      return (input.turn === undefined || posInt(input.turn)) && (input.step === undefined || posInt(input.step)) ? undefined : 'turn and step must be non-negative integers.';
    case 'graph.focus':
      return typeof input.node === 'string' && input.node.trim() && input.node.length <= 200 && !unknownKeys(input, ['node']) ? undefined : 'Provide node (1-200 characters).';
    case 'layout.set':
      return typeof input.compact === 'boolean' && !unknownKeys(input, ['compact']) ? undefined : 'Provide compact as a boolean.';
    default:
      return undefined;
  }
}
