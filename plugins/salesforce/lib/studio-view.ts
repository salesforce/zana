/**
 * STUB - owned by WS-1 (agent knows the screen). View-state publish/get, contributeInstructions, mention providers.
 * Registers its RPC names from STUDIO_RPC and answers { ok:false, code:'not_implemented' } until implemented.
 */
import { STUDIO_RPC } from './studio-contract.js';
import { registerStubRpcs, type StudioServerContext } from './studio-server-context.js';

/** studio.view.publish / studio.view.get. WS-1 also adds the single contributeInstructions provider and mention providers here. */
export function registerStudioContext(studio: StudioServerContext): void {
  registerStubRpcs(studio, [STUDIO_RPC.viewPublish, STUDIO_RPC.viewGet]);
}
