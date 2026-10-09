/**
 * STUB - owned by WS-5 (Studio IDE layout). Explorer tree.
 * Registers its RPC names from STUDIO_RPC and answers { ok:false, code:'not_implemented' } until implemented.
 */
import { STUDIO_RPC } from './studio-contract.js';
import { registerStubRpcs, type StudioServerContext } from './studio-server-context.js';

/** studio.explorer. */
export function registerStudioExplorer(studio: StudioServerContext): void {
  registerStubRpcs(studio, [STUDIO_RPC.explorer]);
}
