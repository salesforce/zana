/**
 * Public plugin-facing aliases for host-owned capability contracts. Plugins
 * provide ids and bounded values; host authority resolves paths, credentials,
 * and execution targets.
 */
import type {
  CapabilityIntrospectionContract,
  ContractJson,
  DispatchAdmissionContract,
  DispatchAdmissionDecision,
  DispatchAdmissionPrompt,
  DispatchEntry,
  DispatchOrigin,
  DispatchSurface,
  HostRpcContract,
  HostRpcResultContract,
  InteractionAcknowledgement,
  InteractionContract,
  LifecycleEventContract,
  NativeToolLifecycleContract,
  PersonaContributionContract,
  ProjectTabAvailabilityContract,
  TeamContributionContract,
  ToolSettledContract,
  ToolSettledState,
} from '@zana-ai/zcc-domain';
import type {
  ApprovalPendingInteractionResolution,
  PendingInteractionApprovalDecision,
  PendingInteractionGrantedPermissionProfile,
  PendingInteractionStatus
} from '@zana-ai/zcc-domain/thread-runtime';

export type {
  CapabilityIntrospectionContract,
  DispatchAdmissionContract,
  DispatchAdmissionDecision,
  DispatchAdmissionPrompt,
  DispatchEntry,
  DispatchOrigin,
  DispatchSurface,
  HostRpcContract,
  HostRpcResultContract,
  InteractionAcknowledgement,
  InteractionContract,
  LifecycleEventContract,
  NativeToolLifecycleContract,
  PersonaContributionContract,
  ProjectTabAvailabilityContract,
  TeamContributionContract,
  ToolSettledContract,
  ToolSettledState,
};

export interface PluginHostRpc {
  invoke(request: HostRpcContract): Promise<HostRpcResultContract>;
}

/** Bounded upsert input for a resumable interaction. `projectId` scopes the quota; the host stamps `pluginId`. */
export interface PluginInteractionUpsertInput {
  projectId: string;
  correlationId: string;
  kind: string;
  payload: ContractJson;
}

export interface PluginInteractions {
  get(interactionId: string): Promise<InteractionContract | null>;
  upsert(input: PluginInteractionUpsertInput): Promise<InteractionContract>;
  acknowledge(request: InteractionAcknowledgement): Promise<InteractionContract>;
  cancel(request: InteractionAcknowledgement): Promise<InteractionContract>;
}

/** A plugin's assertion that it authenticated a human action on an external service. Never native human proof. */
export interface PluginRelayedHumanActor {
  kind: 'plugin-relayed-human';
  /** Must equal the calling plugin's host-owned identity. */
  pluginId: string;
  /** Stable external account id, including tenant/workspace when applicable; 1–256 characters. */
  externalUser: string;
}

export type PluginThreadInteractionErrorCode =
  | 'invalid_request' | 'not_found' | 'forbidden' | 'conflict'
  | 'native_confirmation_required' | 'unsupported_interaction' | 'unavailable';

/** Across a plugin worker boundary, match `name` and `code`; Error prototypes do not cross workers. */
export class PluginThreadInteractionError extends Error {
  readonly name = 'PluginThreadInteractionError';
  constructor(readonly code: PluginThreadInteractionErrorCode, message: string, readonly status: number) {
    super(message);
  }
}

export type PluginThreadInteractionResolution = ApprovalPendingInteractionResolution;

/** Host projection, without raw arguments, plugin data, plan bodies, or provider routing ids. Text is untrusted display text. */
export interface PluginThreadInteraction {
  id: string;
  threadId: string;
  kind: string;
  subjectKind: string | null;
  summary: string;
  summaryTruncated: boolean;
  tool: string | null;
  allowedDecisions: PendingInteractionApprovalDecision[];
  /** Exact profile required for permission grants or command/file session grants. */
  grantPermissions: PendingInteractionGrantedPermissionProfile | null;
  status: PendingInteractionStatus;
  createdAt: number;
  resolvedAt: number | null;
  resolution: PluginThreadInteractionResolution | null;
  refusalReason: 'native_confirmation_required' | 'unsupported_interaction' | null;
}

/** Only conversations whose stored originPluginId is this plugin. Expected failures throw PluginThreadInteractionError. */
export interface PluginThreadInteractions {
  list(args: { threadId: string }): Promise<PluginThreadInteraction[]>;
  resolve(args: {
    threadId: string;
    interactionId: string;
    resolution: PluginThreadInteractionResolution;
    actor: PluginRelayedHumanActor;
  }): Promise<PluginThreadInteraction>;
}

export interface PluginCapabilityIntrospection {
  /** Capability descriptors scoped to a specific thread's resolved provider. */
  forThread(args: { threadId: string }): Promise<CapabilityIntrospectionContract>;
  /**
   * Capability descriptors scoped to an execution. An execution can span
   * multiple provider slots, so provider-specific descriptors (native tool
   * hooks) report `available: false` rather than guessing a provider.
   */
  forExecution(args: { executionId: string }): Promise<CapabilityIntrospectionContract>;
}
