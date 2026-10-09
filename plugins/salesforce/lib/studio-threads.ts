/**
 * STUB - owned by WS-1 (assistant rail). Thread links + askAgent.
 * Registers its RPC names from STUDIO_RPC and answers { ok:false, code:'not_implemented' } until implemented.
 */
import { STUDIO_RPC } from './studio-contract.js';
import { registerStubRpcs, type StudioServerContext } from './studio-server-context.js';

/** studio.askAgent, studio.threads, studio.unlinkThread. Real impl lives in this file (WS-1). */
export function registerStudioAssistant(studio: StudioServerContext): void {
  registerStubRpcs(studio, [STUDIO_RPC.askAgent, STUDIO_RPC.threads, STUDIO_RPC.unlink]);
}
