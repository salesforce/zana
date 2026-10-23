import type { BrowserWindow } from 'electron';
import { createInteractionResponder } from '../interaction-proof.js';

export const INTERACTION_RESPONSE_CHANNEL = 'interactions:respond';

export function registerInteractionResponseIpc(
  register: (channel: string, handler: (win: BrowserWindow, input: unknown) => Promise<unknown>, onError: (error: unknown) => never) => void,
  respond: ReturnType<typeof createInteractionResponder>
) {
  // The shared registrar verifies the sender frame belongs to a live app window.
  register(INTERACTION_RESPONSE_CHANNEL, async (win, input) => {
    if (win.isDestroyed()) throw new Error('Interaction window closed');
    return respond(input, 'human', `window:${win.id}`);
  }, error => { throw error; });
}
