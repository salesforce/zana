import { AGENT_SOURCE_MAX_LABEL, isProposeEditInput, PREVIEW_ENGINES, type StudioEngine } from './studio-contract.js';
import { parsePreviewContext } from './preview-context.js';

/** Isomorphic input validation for the Studio UI verbs (server request() and the renderer executor share it). */
export const STUDIO_UI_COMMANDS = ['editor.proposeEdit', 'preview.start', 'preview.send', 'trace.focus', 'graph.focus', 'layout.set', 'orgTests.open', 'simulations.open', 'context.set'] as const;
export type StudioUiCommandName = typeof STUDIO_UI_COMMANDS[number];
export const PREVIEW_TEXT_MAX = 4000;
const presetId = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const posInt = (value: unknown) => Number.isInteger(value) && Number(value) >= 0;
const unknownKeys = (input: Record<string, unknown>, allowed: string[]) => Object.keys(input).find(key => !allowed.includes(key));

/** Returns a human-readable problem, or undefined when the input is valid (or the command has no extra rules). */
export function validateUiCommandInput(command: string, input: Record<string, unknown>): string | undefined {
  switch (command) {
    case 'editor.proposeEdit':
      return isProposeEditInput(input) ? undefined : `Provide path, a 64-hex expectedSha256, a summary, and exactly one of content (at most ${AGENT_SOURCE_MAX_LABEL}) or 1-50 edits.`;
    case 'preview.start':
      if (unknownKeys(input, ['engine', 'contextVariables', 'presetId'])) return 'preview.start accepts only engine, contextVariables and presetId.';
      if (input.presetId !== undefined && (!presetId(input.presetId) || input.contextVariables !== undefined)) return 'Provide presetId (a preset id) or contextVariables, not both.';
      try { parsePreviewContext(input.contextVariables); } catch (error) { return (error as Error).message; }
      return input.engine === undefined || PREVIEW_ENGINES.includes(input.engine as StudioEngine) ? undefined : 'engine must be simulate or live.';
    case 'preview.send':
      if (unknownKeys(input, ['text', 'engine'])) return 'preview.send accepts only text and engine.';
      if (input.engine !== undefined && !PREVIEW_ENGINES.includes(input.engine as StudioEngine)) return 'engine must be simulate or live.';
      return typeof input.text === 'string' && input.text.trim() && input.text.length <= PREVIEW_TEXT_MAX ? undefined : `Provide text (1-${PREVIEW_TEXT_MAX} characters).`;
    case 'trace.focus':
      if (unknownKeys(input, ['runId', 'turn', 'step'])) return 'trace.focus accepts runId, turn and step.';
      if (input.runId !== undefined && (typeof input.runId !== 'string' || !input.runId || input.runId.length > 200)) return 'runId must be a short string.';
      return (input.turn === undefined || posInt(input.turn)) && (input.step === undefined || posInt(input.step)) ? undefined : 'turn and step must be non-negative integers.';
    case 'graph.focus':
      return typeof input.node === 'string' && input.node.trim() && input.node.length <= 200 && !unknownKeys(input, ['node']) ? undefined : 'Provide node (1-200 characters).';
    case 'layout.set':
      return typeof input.compact === 'boolean' && !unknownKeys(input, ['compact']) ? undefined : 'Provide compact as a boolean.';
    case 'orgTests.open':
      if (unknownKeys(input, ['name', 'runId'])) return 'orgTests.open accepts only name and runId.';
      if (input.name !== undefined && (typeof input.name !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(input.name))) return 'name must be an AiEvaluationDefinition API name.';
      return input.runId === undefined || (typeof input.runId === 'string' && /^[A-Za-z0-9]{15,18}$/.test(input.runId)) ? undefined : 'runId must be 15 to 18 letters and digits.';
    case 'simulations.open':
      if (unknownKeys(input, ['batchId'])) return 'simulations.open accepts only batchId.';
      return input.batchId === undefined || (typeof input.batchId === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(input.batchId)) ? undefined : 'batchId must be the id simulations.start returned.';
    case 'context.set':
      if (unknownKeys(input, ['values', 'presetId', 'merge'])) return 'context.set accepts only values, presetId and merge.';
      if ((input.values === undefined) === (input.presetId === undefined)) return 'Provide values or presetId.';
      if (input.presetId !== undefined) return presetId(input.presetId) && input.merge === undefined ? undefined : 'presetId must be a preset id, and a preset replaces the context (no merge).';
      if (input.merge !== undefined && typeof input.merge !== 'boolean') return 'merge must be a boolean.';
      try { parsePreviewContext(input.values); } catch (error) { return (error as Error).message; }
      return undefined;
    default:
      return undefined;
  }
}
