import { expect, it } from 'vitest';
import type { ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import { INVITE_UNSUPPORTED_REASON, inviteCapability } from './server.js';

type Peers = ZccPluginApi['sdk']['peers'];
const methods = ['createInvitation', 'redeemInvitation', 'invitationStatus', 'listInvitations', 'invitationApproval', 'decideInvitation', 'cancelInvitation', 'peerLinks', 'reconnectPeer'];

it('gates invitation UX on every invite method, leaving legacy peer sync untouched', () => {
  const full = Object.fromEntries(methods.map((m) => [m, () => undefined])) as unknown as Peers;
  expect(inviteCapability(full)).toEqual({ available: true });
  const legacy = { enrolled: () => undefined, enable: () => undefined } as unknown as Peers;
  expect(inviteCapability(legacy)).toEqual({ available: false, reason: INVITE_UNSUPPORTED_REASON });
  expect(INVITE_UNSUPPORTED_REASON).toBe('host cannot invite peers');
  const partial = { ...full, reconnectPeer: undefined } as unknown as Peers;
  expect(inviteCapability(partial).available).toBe(false);
  expect(inviteCapability(undefined).available).toBe(false);
});
