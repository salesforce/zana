// Types and constants for the SSH peer transport (replaces the Zana Connect peer-link transport).
// B (the redeemer) opens one ssh to A's (the inviter's) OS sshd: `-L` reaches A's peer forwarder,
// `-R` lets A reach B's. Both connectors then use loopback http URLs. See the plan
// doc-vault design-docs/cross-machine/plan-ssh-peer-transport.md.

export interface PeerSshEndpoint {
  /** `<LocalHostName>.local`, or an IP fallback. */
  host: string;
  port: number;
  user: string;
  /** Full `ssh-ed25519 AAAA…` host key, pinned by the redeemer (stricter than a fingerprint). */
  hostKey: string;
}

/** What the invitation token carries in place of the Connect link. */
export interface InvitationSshOffer {
  v: 1;
  endpoint: PeerSshEndpoint;
  /** base64url ed25519 seed of the throwaway bootstrap key (10-minute bearer, tunnel-only on A). */
  bootstrapSeed: string;
  /** Port on A's loopback that `-R` may listen on (`permitlisten`). */
  listenPort: number;
  /** A's peer forwarder port F that `-L` may reach (`permitopen`). */
  targetPort: number;
  /** A's forward-only host id for the join code. */
  hostId: string;
  /** Forward-only `zcde_` join code for A's server. */
  joinCode: string;
}

export interface InvitationLinkMint {
  offer: InvitationSshOffer;
  expiresAt: number;
}

export const SSH_REASONS = [
  'ssh_remote_login_off',
  'ssh_unreachable',
  'ssh_auth_refused',
  'ssh_forwarding_refused',
  'ssh_host_key_mismatch'
] as const;
export type SshReason = (typeof SSH_REASONS)[number];

export type AuthorizedKeyKind = 'bootstrap' | 'link';

export interface AuthorizedKeyInput {
  linkId: string;
  kind: AuthorizedKeyKind;
  /** `ssh-ed25519 <base64>` public key line without a comment. */
  pub: string;
  listenPort: number;
  targetPort: number;
  /** Bootstrap lines carry an sshd `expiry-time` so they die on their own if Zana crashes. */
  expiresAt?: number;
}

/** Zana-owned lines in the user's authorized_keys (A side). Foreign lines are never touched. */
export interface AuthorizedKeys {
  upsert(input: AuthorizedKeyInput): Promise<void>;
  remove(linkId: string, kind?: AuthorizedKeyKind): Promise<void>;
  /** Drop every Zana-owned line whose link is not in `liveLinkIds`. */
  reconcile(liveLinkIds: ReadonlySet<string>): Promise<void>;
  list(): Promise<Array<{ linkId: string; kind: AuthorizedKeyKind }>>;
}

export interface OpenTunnelInput {
  endpoint: PeerSshEndpoint;
  /** Throwaway bootstrap seed, or this link's own key once both owners approved. */
  identity: { seed: string } | { linkKey: true };
  listenPort: number;
  targetPort: number;
  /** Reuse the same local port across reconnects. */
  localPort?: number;
}

export interface PeerSshTunnel {
  /** `http://127.0.0.1:<localPort>/` */
  url: string;
  localPort: number;
  close(): Promise<void>;
}

/** Injected into PeerLinks; faked in unit tests. */
export interface PeerSshTransport {
  /** A: probe sshd and self-test. Throws an Error whose message is one of SSH_REASONS. */
  localEndpoint(signal: AbortSignal): Promise<PeerSshEndpoint>;
  /** A: refcounted lazy peer forwarder; nothing listens when no A-side link exists. */
  forwarder: { acquire(linkId: string): Promise<number>; release(linkId: string): Promise<void> };
  authorizedKeys: AuthorizedKeys;
  /** B: open (and keep open, with bounded backoff) the ssh tunnel. */
  openTunnel(
    linkId: string,
    input: OpenTunnelInput,
    onState: (up: boolean, failure?: SshReason) => void
  ): Promise<PeerSshTunnel>;
  /** B: this link's own public key line, created on first use. */
  linkKey(linkId: string): Promise<string>;
  dropLinkKey(linkId: string): Promise<void>;
  /** B: drop sealed key seeds that have no live link record (a failed redeem must not leak one). Seeds younger than a grace period are kept. */
  reconcileLinkKeys?(liveLinkIds: ReadonlySet<string>): Promise<void>;
}
