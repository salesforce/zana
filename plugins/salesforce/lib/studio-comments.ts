/**
 * STUB - owned by WS-3 (editor, proposals, comments). Comment store.
 * Registers its RPC names from STUDIO_RPC and answers { ok:false, code:'not_implemented' } until implemented.
 */
import { STUDIO_RPC } from './studio-contract.js';
import { registerStubRpcs, type StudioServerContext } from './studio-server-context.js';

/** studio.comments.list / add / resolve. */
export function registerStudioComments(studio: StudioServerContext): void {
  registerStubRpcs(studio, [STUDIO_RPC.comments, STUDIO_RPC.commentAdd, STUDIO_RPC.commentResolve]);
}
