/**
 * Shared `inbox:push` validation, used by BOTH the renderer-panel IPC handler
 * (`index.ts`, `window.cc.modules.pushInbox`) and the brokered disk-extension
 * path (`broker-caps.ts`'s `inboxPush`, reached from a sandboxed `main.mjs` via
 * `ctx.inbox.push`). One place to keep the "which projectId may this push
 * target" gate in sync across both callers.
 *
 * `moduleId` is NOT re-gated here — each caller already asserted `inbox:push`
 * against the {@link import('./permission-broker.js').PermissionBroker} before
 * reaching this helper. `extensionSource` is caller-supplied, not derived: only
 * the brokered path passes it (its `moduleId` is the AUTHENTICATED id bound to
 * the child's port — Rule 1); the renderer-panel path's `moduleId` is merely a
 * claimed arg, so it stays unstamped. `target` (click-navigation redirect,
 * Rule 1) follows the same trust line — it's rejected outright unless
 * `extensionSource` is present, and even then only when it names its OWN id.
 */

import type { IInboxStore, InboxInput } from '@zana-ai/zcc-server';

export interface InboxBrokerDeps {
  inboxStore: Pick<IInboxStore, 'append'>;
  projectExists: (projectId: string) => boolean;
}

export interface PushInboxMessage {
  projectId: string;
  comments?: string;
  docs?: Array<{ path: string }>;
  /**
   * Optional click-navigation target — see {@link import('@zana-ai/zcc-server').InboxInput.target}.
   * Only meaningful alongside `opts.extensionSource` (the brokered path); the
   * renderer-panel path never passes this (its `moduleId` claim isn't
   * authenticated, so it can't be trusted to name a redirect target either).
   */
  target?: { moduleId: string };
}

export async function pushInboxOnBehalfOf(
  deps: InboxBrokerDeps,
  moduleId: string,
  msg: PushInboxMessage,
  opts?: { extensionSource?: { extensionId: string } }
): Promise<{ id: string }> {
  // A grant to push is not authorization to target ANY project: verify the
  // projectId actually exists. `inboxStore.append` only shape-validates the id,
  // so without this a module could stamp an entry onto an arbitrary / foreign
  // projectId string (an inbox tombstone the user can't act on).
  if (!deps.projectExists(msg.projectId)) {
    throw new Error(`inbox push rejected: unknown projectId ${msg.projectId}`);
  }
  // `target` is only trustworthy alongside an AUTHENTICATED `extensionSource`
  // (the brokered child path's port-bound moduleId) — the renderer-panel path's
  // `moduleId` is merely a claimed arg (see the module doc comment above), so a
  // target on that path rejects outright rather than being persisted as if
  // verified. Even authenticated, a push may only name ITSELF as the target,
  // never a sibling module — the registry is re-checked again at click time
  // anyway (renderer-side), since the module set can change between push and
  // click.
  if (msg.target && !opts?.extensionSource) {
    throw new Error('inbox push rejected: target requires an authenticated extension origin');
  }
  if (msg.target && opts?.extensionSource && msg.target.moduleId !== opts.extensionSource.extensionId) {
    throw new Error("inbox push rejected: target.moduleId must be the pushing extension's own id");
  }
  const input: InboxInput = {
    projectId: msg.projectId,
    comments: msg.comments,
    docs: msg.docs,
    ...(msg.target ? { target: msg.target } : {}),
    ...(opts?.extensionSource ? { extensionSource: opts.extensionSource } : {})
  };
  const entry = await deps.inboxStore.append(input);
  return { id: entry.id };
}
