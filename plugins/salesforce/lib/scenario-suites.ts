/**
 * STUB - owned by WS-6 (unified preview, trace, suites). Scenario suites and agentLab.trace.
 * Registers its RPC names from STUDIO_RPC and answers { ok:false, code:'not_implemented' } until implemented.
 */
import { STUDIO_RPC } from './studio-contract.js';
import { registerStubRpcs, type StudioServerContext } from './studio-server-context.js';

/** agentLab.trace + studio.suites.list / save / run. */
export function registerStudioPreview(studio: StudioServerContext): void {
  registerStubRpcs(studio, [STUDIO_RPC.trace, STUDIO_RPC.suites, STUDIO_RPC.suiteSave, STUDIO_RPC.suiteRun]);
}
