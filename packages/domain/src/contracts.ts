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

/** Where the dispatch lands: a Modern thread or a PTY Electron-main owns. */
export type DispatchSurface = 'pty' | 'modern';
/** Which input path produced the dispatch. */
export type DispatchEntry = 'initial' | 'reply' | 'fork' | 'squad-member-start' | 'job-team-dispatch';
/** Who produced the text: a person, another agent, or Zana itself. */
export type DispatchOrigin = 'user' | 'agent' | 'system';

/**
 * Opt-in prompt content of a dispatch. Present only for a plugin that declares
 * `zcc.promptAccess: true`; the text is redacted and capped, never the raw prompt.
 */
export interface DispatchAdmissionPrompt {
  text: string;
  /** True when the text was cut to the byte cap. */
  truncated: boolean;
  /** Attachments on the dispatch; their content is never provided. */
  attachmentCount: number;
}

/**
 * Host-owned identity for one dispatch. Names a thread (Modern) or a session
 * (PTY); a PTY dispatch carries no `threadId` because an unbound PTY is not a
 * thread, and an initial dispatch may name neither before the target exists.
 */
export interface DispatchAdmissionContract {
  dispatchId: string;
  threadId?: string;
  sessionId?: string;
  projectId: string;
  generation: number;
  surface: DispatchSurface;
  entry: DispatchEntry;
  origin: DispatchOrigin;
  /** Only for plugins that declare `zcc.promptAccess: true`; absent otherwise and for entries with no text (fork). */
  prompt?: DispatchAdmissionPrompt;
}

/** Terminal state of one native tool invocation. */
export type ToolSettledState = 'succeeded' | 'failed' | 'cancelled';

/**
 * Best-effort, observational completion of a native tool call, correlated to the
 * policy request by `invocationId`. `outputPreview` is present only for a plugin
 * that declares `zcc.toolResults: 'preview'`; it is redacted and capped at 4 KiB.
 */
export interface ToolSettledContract {
  invocationId: string;
  /** PTY session id; present on the PTY surface. */
  sessionId?: string;
  /** Thread id; present on the Modern surface. */
  threadId?: string;
  projectId: string;
  providerId: string;
  toolName: string;
  state: ToolSettledState;
  durationMs: number;
  exitCode?: number;
  outputBytes?: number;
  outputPreview?: string;
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

export type InteractionActor = 'human' | 'cli' | 'agent' | 'unknown';

export interface CapabilitySurfaceKey {
  surface: 'pty' | 'modern';
  harness: string;
  headless: boolean;
  hookBase: boolean;
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
