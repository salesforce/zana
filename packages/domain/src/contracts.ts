/**
 * Stable contracts for plugin capabilities that cross process boundaries.
 * Values here are identifiers or bounded JSON; main resolves every capability
 * to local authority before it reaches a host or renderer.
 */

export type ContractJson =
  | null
  | boolean
  | number
  | string
  | readonly ContractJson[]
  | { readonly [key: string]: ContractJson };

export interface HostRpcContract {
  projectId: string;
  hostId?: string;
  method: string;
  input?: ContractJson;
}

export interface HostRpcResultContract {
  result: ContractJson;
}

export type InteractionStatus =
  | 'pending'
  | 'acknowledged'
  | 'ack-timeout'
  | 'resolved'
  | 'cancelled';

export interface InteractionContract {
  id: string;
  pluginId: string;
  projectId: string;
  correlationId: string;
  kind: string;
  payload: ContractJson;
  status: InteractionStatus;
  generation: number;
  createdAt: number;
  updatedAt: number;
  acknowledgedAt: number | null;
  terminalAt: number | null;
  expiresAt: number | null;
}

export interface InteractionAcknowledgement {
  interactionId: string;
  generation: number;
}

export type DispatchAdmissionDecision =
  | { action: 'proceed' }
  | { action: 'wait'; reason: string; overrideable: boolean; pluginId?: string }
  | { action: 'reject'; message: string };

export interface DispatchAdmissionContract {
  dispatchId: string;
  threadId: string;
  projectId: string;
  generation: number;
}

export interface LifecycleEventContract {
  id: string;
  sequence: number;
  timestamp: number;
  type: string;
  projectId: string;
  payload: ContractJson;
}

export type NativeToolLifecycleState =
  | 'announced'
  | 'awaiting-decision'
  | 'allowed'
  | 'denied'
  | 'executing'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface NativeToolLifecycleContract {
  invocationId: string;
  threadId: string;
  projectId: string;
  sequence: number;
  state: NativeToolLifecycleState;
  timestamp: number;
  payload: ContractJson;
}

export interface PersonaContributionContract {
  id: string;
  displayName: string;
  description?: string;
}

export interface TeamContributionContract {
  id: string;
  displayName: string;
  personaIds: readonly string[];
}

export interface CapabilityDescriptor {
  id: string;
  available: boolean;
  reason?: string;
}

export interface CapabilityIntrospectionContract {
  capabilities: readonly CapabilityDescriptor[];
}

export interface ProjectTabAvailabilityContract {
  available: boolean;
  reason?: string;
}
