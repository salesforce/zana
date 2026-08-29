/**
 * Main-process binding for the dependency-free harness SDK registration.
 *
 * The SDK deliberately cannot import application configuration or process
 * launch code. This type adds those trusted, main-only concerns at the host
 * boundary while leaving each harness folder responsible for its registration.
 */

import type { HarnessRegistration as SdkHarnessRegistration, HarnessVerificationDefinition } from '@zcc/harness-sdk';
import type { AppConfig, CreateTerminalRequest, HarnessFamily, LaunchProfileId, TerminalSession } from '@zana-ai/zcc-domain/product';
import type { HarnessAgentDiscoveryResult } from '@zana-ai/zcc-domain/harness-adapter';
import type { LaunchProvider, RemoteCommandInput, RemoteCommandResult } from './launch-provider.js';
import type { HarnessTranscriptAdapter, NativeSessionPatch } from './session-adapter.js';

export interface HarnessMonitorCapability {
  readonly state: 'supported' | 'unsupported';
  readonly sources: readonly string[];
  readonly reason?: string;
}

export type NativeConversationResume = Pick<
  CreateTerminalRequest,
  'profile' | 'extraArgs' | 'resumeSessionId'
>;

export interface RestoreProjection extends NativeConversationResume {
  /** Preserve host-owned defaults when a registration has no native session id. */
  readonly extraArgs?: string[];
}

export interface HarnessRegistration extends SdkHarnessRegistration<LaunchProfileId, LaunchProvider> {
  readonly id: HarnessFamily | 'shell';
  readonly verification?: HarnessVerificationDefinition;
  /** Refresh dynamic descriptor targets only after a successful binary probe. */
  readonly refreshCatalog?: (input: {
    readonly binary: string;
    readonly normalizedVersion?: string;
  }) => Promise<void>;
  /** Main-owned transcript/session bridge. Created once by TranscriptSource. */
  readonly createTranscriptAdapter?: (input: { openCodeBinary: () => string }) => HarnessTranscriptAdapter;
  /** Verified native monitor signals only; absent support remains explicit. */
  readonly monitorCapability: HarnessMonitorCapability;
  /** Harness-owned exact native resume projection for trusted native ids. */
  readonly nativeConversationResume?: (nativeConversationId: string) => NativeConversationResume | undefined;
  /** Read this registration's native conversation identity from a trusted session. */
  readonly nativeConversationId?: (session: Pick<TerminalSession, 'claudeSessionId' | 'codexSessionId' | 'openCodeSessionId'>) => string | undefined;
  /** Apply a trusted native identity through the narrow TerminalSession allowlist. */
  readonly nativeSessionPatch?: (nativeConversationId: string) => NativeSessionPatch | undefined;
  /** Build restore-only launch fields while preserving host-owned capability authority. */
  readonly restoreProjection?: (input: {
    readonly session: Pick<TerminalSession, 'profile' | 'claudeSessionId' | 'codexSessionId' | 'openCodeSessionId'>;
    readonly extraArgs?: readonly string[];
  }) => RestoreProjection;
  /** Render harness-native lifecycle configuration from host-minted callback URLs. */
  readonly renderLifecycle?: (input: {
    readonly profile: LaunchProfileId;
    readonly caps: import('@zana-ai/zcc-domain/launch-provider').ProviderCapabilities;
    readonly config: AppConfig;
    readonly scheduled: boolean;
    readonly headless: boolean;
    readonly autoModeActive: boolean;
    readonly callbacks: {
      readonly stop?: string;
      readonly notify?: string;
      readonly firstPrompt?: string;
      readonly subagent?: string;
      readonly toolActivity?: string;
      readonly overseer?: string;
      readonly contentScreen?: string;
    };
    readonly scope: 'local' | 'remote';
  }) => { readonly args: readonly string[]; readonly env: Readonly<Record<string, string>> };
  /**
   * Optional local catalog discovery. Main authorizes the project path and profile
   * before calling this; absence means the harness does not support discovery.
   */
  readonly discoverAgentDescriptors?: (input: {
    readonly profile: LaunchProfileId;
    readonly cwd: string;
    readonly config: AppConfig;
    readonly refresh: boolean;
  }) => Promise<HarnessAgentDiscoveryResult>;
  /** Registration-owned entry point for exact provider-native remote rendering. */
  readonly renderRemoteCommand: (input: RemoteCommandInput) => RemoteCommandResult;
}
