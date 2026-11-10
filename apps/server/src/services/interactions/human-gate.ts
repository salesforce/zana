import type { InteractionActor } from '@zana-ai/zcc-domain';
import { ThreadCreateError } from '../../http/thread-create.js';

/**
 * What a plugin asked of the responder.
 * - `true`: a human acted (the Zana window, or the native sheet).
 * - `'native-sheet'`: a human acted on a sheet the desktop main process drew
 *   itself. The window is not enough, because it is renderer code.
 */
export type RequireHuman = boolean | 'native-sheet';

export const NATIVE_SHEET_REQUIRED = 'native-sheet-required';

/** Null when the response may settle the interaction, else the refusal to throw. */
export function humanGateRefusal(
  requireHuman: RequireHuman | undefined,
  actor: InteractionActor,
  attestation: 'window' | 'sheet' | undefined,
  context: { title: string; pluginId: string }
): ThreadCreateError | null {
  if (!requireHuman) return null;
  if (actor !== 'human') {
    return new ThreadCreateError(403, 'human-proof-required', 'Human proof required');
  }
  if (requireHuman === 'native-sheet' && attestation !== 'sheet') {
    const error = new ThreadCreateError(403, NATIVE_SHEET_REQUIRED, 'Native approval sheet required');
    error.details = { title: context.title, pluginId: context.pluginId };
    return error;
  }
  return null;
}
