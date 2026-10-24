import type { PluginInvitationDecision, PluginInvitationReason, PluginInvitationState, PluginPeerLink } from '@zana-ai/zcc-plugin-sdk/server';

/** What the Peers view may show about an invitation: no token, locator, key or credential. */
export interface InviteItem {
  invitationId: string;
  role: 'inviter' | 'redeemer';
  state: PluginInvitationState;
  reason: PluginInvitationReason | null;
  /** The other computer once discovered; the fingerprint is for out-of-band confirmation. */
  peer: { instanceId: string; name: string; fingerprint: string } | null;
  localFingerprint: string;
  myDecision: PluginInvitationDecision;
  theirDecision: PluginInvitationDecision;
  /** This owner must still decide: the reserved invitation is waiting on them. */
  awaitingMyApproval: boolean;
  expiresAt: number;
  consentExpiresAt: number | null;
}

export interface InviteView {
  available: boolean;
  /** Set when `available` is false: why the new action cannot run on this host. */
  reason: string | null;
  invitations: InviteItem[];
  links: PluginPeerLink[];
  /** The last automatic Enable failure for an invitation-founded peer, shown until it succeeds. */
  enableError: string | null;
  /** Set when the host failed transiently: this is the last good view, with the failure reason (never a secret). */
  stale?: string;
}
