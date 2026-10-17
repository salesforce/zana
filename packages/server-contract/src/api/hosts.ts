import { z } from "zod";
import { permissionModeSchema } from "@zana-ai/zcc-domain/thread-runtime";
import {
  pathsExistRequestSchema,
  providerCliInstallEventSchema,
  providerCliInstallRequestSchema,
  type PathsExistRequest,
  type PathsExistResponse,
  type PickFolderResponse,
  type ProviderCliInstallEvent,
  type ProviderCliInstallRequest,
  type ProviderCliStatusResponse,
} from "@zana-ai/zcc-host-daemon-contract/local";

/**
 * Query for `GET /hosts/:id/directory`, the interactive path browser's
 * single-level directory read. `path` is an absolute directory on the host;
 * omitting it lists the host's home directory (the daemon resolves it, since a
 * remote caller cannot know the host's home).
 */
export const hostDirectoryQuerySchema = z.object({
  path: z.string().min(1).optional(),
});
export type HostDirectoryQuery = z.infer<typeof hostDirectoryQuerySchema>;

export const hostDirectoryEntrySchema = z.object({
  kind: z.enum(["file", "directory"]),
  name: z.string(),
  path: z.string(),
});
export type HostDirectoryEntry = z.infer<typeof hostDirectoryEntrySchema>;

export const hostDirectoryListingSchema = z.object({
  // Resolved absolute directory that was listed (symlinks already followed).
  directory: z.string(),
  // Absolute parent directory, or null at the filesystem root.
  parent: z.string().nullable(),
  entries: z.array(hostDirectoryEntrySchema),
});
export type HostDirectoryListing = z.infer<typeof hostDirectoryListingSchema>;

/** Project name is sent so the daemon can derive its host-local checkout path. */
export const hostCloneDefaultPathQuerySchema = z.object({
  projectId: z.string().min(1),
});
export type HostCloneDefaultPathQuery = z.infer<
  typeof hostCloneDefaultPathQuerySchema
>;

export const hostCloneDefaultPathResponseSchema = z
  .object({ path: z.string().min(1) })
  .strict();
export type HostCloneDefaultPathResponse = z.infer<
  typeof hostCloneDefaultPathResponseSchema
>;

// The machine names itself at enroll time (the daemon reports its hostname),
// so minting takes no fields.
export const createHostJoinCodeRequestSchema = z.object({}).strict();
export type CreateHostJoinCodeRequest = z.infer<
  typeof createHostJoinCodeRequestSchema
>;

export const createHostJoinCodeResponseSchema = z.object({
  joinCode: z.string().min(1),
  hostId: z.string().min(1),
  expiresAt: z.number().int().positive(),
  /** Preferred route only: the URL this code redeems against, bound to the same relay session. */
  pairingServerUrl: z.string().min(1).optional(),
  /** Preferred route only: `tunnel` when the code redeems through the SSH reverse-tunnel forwarder instead of the relay. */
  pairingMode: z.enum(['relay', 'tunnel']).optional(),
});
export type CreateHostJoinCodeResponse = z.infer<
  typeof createHostJoinCodeResponseSchema
>;

/** A sponsor-delivered introduction awaiting this machine owner's consent. Carries no credentials or routes. */
export const peerIntroductionSchema = z.object({
  introductionId: z.string().min(1),
  sponsorInstanceId: z.string().min(1),
  peerInstanceId: z.string().min(1),
  pluginId: z.string().min(1),
  scope: z.string().min(1),
  status: z.enum(["pending", "approved", "denied"]),
  receivedAt: z.number().int().nonnegative(),
  /** Approved without an owner decision (covered by an invitation-founded sponsor link); removable via the scoped revoke. */
  autoApproved: z.literal(true).optional(),
});
export type PeerIntroduction =z.infer<typeof peerIntroductionSchema>;
export const peerIntroductionListResponseSchema = z.object({ introductions: z.array(peerIntroductionSchema) });
export type PeerIntroductionListResponse = z.infer<typeof peerIntroductionListResponseSchema>;
export const peerIntroductionDecisionRequestSchema = z
  .object({ decision: z.enum(["approved", "denied"]) })
  .strict();
export type PeerIntroductionDecisionRequest = z.infer<typeof peerIntroductionDecisionRequestSchema>;

/** One reason a plugin link exists. `label` is the plugin's registered display name, chosen by core. */
export const peerLinkUseSchema = z.object({
  pluginId: z.string().min(1).max(128),
  label: z.string().min(1).max(80),
  scope: z.string().min(1).max(256),
  since: z.number().int().nonnegative(),
  /** Short status the using plugin reported for this link. Core relays it verbatim and never interprets it. */
  note: z.object({
    state: z.enum(["ok", "attention"]),
    label: z.string().min(1).max(40),
    detail: z.string().max(200).optional(),
  }).strict().optional(),
});
export type PeerLinkUse = z.infer<typeof peerLinkUseSchema>;
/** `unclaimed`: a forward-only host no owner store claims (e.g. migrated); the owner can remove it. */
export const peerLinkStateSchema = z.enum(["pre-consent", "activating", "linked", "removed", "failed", "unclaimed"]);
export type PeerLinkState = z.infer<typeof peerLinkStateSchema>;
/** A forward-only plugin link. Never carries codes, keys, credentials or routes. */
export const peerLinkSchema = z.object({
  hostId: z.string().min(1),
  /** Absent when no owner store describes the peer (unclaimed links). */
  peerInstanceId: z.string().min(1).nullable(),
  peerName: z.string().min(1),
  state: peerLinkStateSchema,
  /** Stated reason for `failed` links. */
  reason: z.string().max(200).optional(),
  connected: z.boolean(),
  /** Owner disconnected the link: record and keys are kept, nothing connects until Reconnect. */
  paused: z.boolean().optional(),
  uses: z.array(peerLinkUseSchema).max(32),
});
export type PeerLink = z.infer<typeof peerLinkSchema>;
export const peerLinkListResponseSchema = z.object({ links: z.array(peerLinkSchema) });
export type PeerLinkListResponse = z.infer<typeof peerLinkListResponseSchema>;
/** Optional `scope` narrows removal to one use; without it every scope of the plugin is removed. */
export const removePeerLinkUseQuerySchema = z.object({ scope: z.string().min(1).max(256).optional() }).strict();
export type RemovePeerLinkUseQuery = z.infer<typeof removePeerLinkUseQuerySchema>;
export const removePeerLinkResponseSchema = z.object({
  ok: z.literal(true),
  /** True when this removal took the last use and the link itself was torn down. */
  linkRemoved: z.boolean(),
});
export type RemovePeerLinkResponse = z.infer<typeof removePeerLinkResponseSchema>;
/** Owner Disconnect / Reconnect of a link; the record survives either way. */
export const pausePeerLinkResponseSchema = z.object({ ok: z.literal(true), paused: z.boolean() });
export type PausePeerLinkResponse = z.infer<typeof pausePeerLinkResponseSchema>;

/** Forward-only link the installer created from an approved introduction. Never carries codes, keys or routes. */
export const peerInstallationSchema = z.object({
  introductionId: z.string().min(1),
  role: z.enum(["requester", "responder"]),
  peerInstanceId: z.string().min(1),
  sponsorInstanceId: z.string().min(1),
  pluginId: z.string().min(1),
  scope: z.string().min(1),
  /** `awaiting`: this owner consented; the pair waits for the other owner. Nothing is minted while awaiting. */
  status: z.enum(["awaiting", "pending", "enrolled", "failed"]),
  capability: z.literal("peer.forward"),
  expiresAt: z.number().int().nonnegative(),
  connected: z.boolean(),
});
export type PeerInstallation = z.infer<typeof peerInstallationSchema>;
export const peerInstallationListResponseSchema = z.object({ installations: z.array(peerInstallationSchema) });
export type PeerInstallationListResponse = z.infer<typeof peerInstallationListResponseSchema>;
/** Owner-registered fixed SSH route to a peer's loopback app server. The host key is pinned; nothing is learned. */
export const peerSshEndpointSchema = z
  .object({
    peerInstanceId: z.string().min(1).max(128),
    host: z.string().min(1).max(253),
    port: z.number().int().min(1).max(65535),
    user: z.string().min(1).max(32),
    hostKey: z.string().min(1).max(4200),
    remoteAppPort: z.number().int().min(1).max(65535),
    identityFile: z.string().min(1).max(1024).optional(),
  })
  .strict();
export type PeerSshEndpoint = z.infer<typeof peerSshEndpointSchema>;
export const peerSshEndpointListResponseSchema = z.object({ endpoints: z.array(peerSshEndpointSchema) });
export type PeerSshEndpointListResponse = z.infer<typeof peerSshEndpointListResponseSchema>;
/**
 * Owner-managed allowlist entry for advertised peer routes: an https origin, or http on loopback. No credentials,
 * path, query, fragment or wildcard; the server canonicalizes and enforces the full rule and a cap of 32 entries.
 */
export const peerRouteOriginRequestSchema = z.object({ origin: z.string().min(1).max(256) }).strict();
export type PeerRouteOriginRequest = z.infer<typeof peerRouteOriginRequestSchema>;
export const peerRouteOriginListResponseSchema = z.object({ origins: z.array(z.string()).max(32) });
export type PeerRouteOriginListResponse = z.infer<typeof peerRouteOriginListResponseSchema>;
export type PeerRouteOriginAddResponse = { origin: string };
export type PeerRouteOriginRemoveResponse = { removed: boolean };

export const updateHostRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    /** Empty or null clears the per-machine default (fall through to global / HOME). */
    defaultWorkspacePath: z.union([z.string().max(256), z.null()]).optional(),
  })
  .strict()
  .refine(
    (data) => data.name !== undefined || data.defaultWorkspacePath !== undefined,
    { message: "name or defaultWorkspacePath required" },
  );
export type UpdateHostRequest = z.infer<typeof updateHostRequestSchema>;

/**
 * Body for `PATCH /hosts/:id/permission-ceiling`. Deliberately its own route
 * rather than a field on `updateHostRequestSchema`: the ceiling is the control
 * that stops one machine from running privileged work on another, so it is
 * owner-session-only and is not part of the SDK or the `bb` CLI surface.
 */
export const updateHostPermissionCeilingRequestSchema = z
  .object({
    maxPermissionMode: permissionModeSchema,
  })
  .strict();
export type UpdateHostPermissionCeilingRequest = z.infer<
  typeof updateHostPermissionCeilingRequestSchema
>;

export const hostRetryUpdateResponseSchema = z
  .object({ ok: z.literal(true) })
  .strict();
export type HostRetryUpdateResponse = z.infer<
  typeof hostRetryUpdateResponseSchema
>;

export const hostSshIdentityRequestSchema = z
  .object({
    host: z.string().trim().min(1).max(256),
    user: z.string().trim().min(1).max(256).optional(),
    proxyJump: z.string().trim().min(1).max(256).optional(),
  })
  .strict();
export type HostSshIdentityRequest = z.infer<typeof hostSshIdentityRequestSchema>;

/** Install for a remote project, or for a machine by SSH identity alone. */
export const hostBootstrapRequestSchema = z.union([
  z
    .object({
      projectId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      ssh: hostSshIdentityRequestSchema.pick({ host: true, user: true }).strict(),
    })
    .strict(),
]);
export type HostBootstrapRequest = z.infer<typeof hostBootstrapRequestSchema>;

export const hostBootstrapLogEventSchema = z.object({
  type: z.literal("log"),
  text: z.string(),
});
export const hostBootstrapDoneEventSchema = z.object({
  type: z.literal("done"),
  hostId: z.string().min(1),
});
export const hostBootstrapErrorEventSchema = z.object({
  type: z.literal("error"),
  code: z.string().min(1),
  message: z.string().min(1),
  pairingCommand: z.string().min(1).optional(),
});
export const hostBootstrapStageSchema = z.enum([
  "ssh",
  "tunnel",
  "install",
  "wait",
  "register",
  "connected",
]);
export type HostBootstrapStage = z.infer<typeof hostBootstrapStageSchema>;
export const hostBootstrapStageEventSchema = z.object({
  type: z.literal("stage"),
  stage: hostBootstrapStageSchema,
  status: z.enum(["running", "passed", "failed"]),
  reason: z.string().min(1).optional(),
  limitMs: z.number().int().positive().optional(),
});
export const hostBootstrapEventSchema = z.discriminatedUnion("type", [
  hostBootstrapLogEventSchema,
  hostBootstrapStageEventSchema,
  hostBootstrapDoneEventSchema,
  hostBootstrapErrorEventSchema,
]);
export type HostBootstrapEvent = z.infer<typeof hostBootstrapEventSchema>;

export const hostPathsExistRequestSchema = pathsExistRequestSchema;
export type HostPathsExistRequest = PathsExistRequest;

export type HostPathsExistResponse = PathsExistResponse;

export const hostPickFolderRequestSchema = z
  .object({
    clientHostId: z.string().min(1),
  })
  .strict();
export type HostPickFolderRequest = z.infer<typeof hostPickFolderRequestSchema>;

export type HostPickFolderResponse = PickFolderResponse;

export type HostProviderCliStatusResponse = ProviderCliStatusResponse;

export const hostProviderCliInstallRequestSchema =
  providerCliInstallRequestSchema;
export type HostProviderCliInstallRequest = ProviderCliInstallRequest;

export const hostProviderCliInstallEventSchema = providerCliInstallEventSchema;
export type HostProviderCliInstallEvent = ProviderCliInstallEvent;
