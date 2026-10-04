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
  HostRpcContract,
  HostRpcResultContract,
  InteractionAcknowledgement,
  InteractionContract,
  LifecycleEventContract,
  NativeToolLifecycleContract,
  PersonaContributionContract,
  ProjectTabAvailabilityContract,
  TeamContributionContract,
} from '@zana-ai/zcc-domain';

export type {
  CapabilityIntrospectionContract,
  DispatchAdmissionContract,
  DispatchAdmissionDecision,
  HostRpcContract,
  HostRpcResultContract,
  InteractionAcknowledgement,
  InteractionContract,
  LifecycleEventContract,
  NativeToolLifecycleContract,
  PersonaContributionContract,
  ProjectTabAvailabilityContract,
  TeamContributionContract,
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
