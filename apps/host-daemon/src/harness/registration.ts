/**
 * Main-process binding for the dependency-free harness SDK registration.
 *
 * The SDK deliberately cannot import application configuration or process
 * launch code. This type adds those trusted, main-only concerns at the host
 * boundary while leaving each harness folder responsible for its registration.
 */

import type { HarnessRegistration as SdkHarnessRegistration, HarnessVerificationDefinition, HarnessHistoryAdapter } from '@zcc/harness-sdk';
import type { AppConfig, CreateTerminalRequest, HarnessFamily, LaunchProfileId, TerminalSession } from '@zana-ai/zcc-domain/product';
import type { HarnessAgentDiscoveryResult } from '@zana-ai/zcc-domain/harness-adapter';
import type { LaunchProvider, RemoteCommandInput, RemoteCommandResult } from './launch-provider.js';
import type { HarnessTranscriptAdapter, NativeSessionPatch } from './session-adapter.js';

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
  /** Optional native history, instantiated once with host-owned storage roots. */
  readonly createHistoryAdapter?: (input: { home: string; dataDir: string }) => HarnessHistoryAdapter;
  readonly historyUnavailableReason?: string;
  /** Provider icon identity shared by the thread and native-history surfaces. */
  readonly historyIconId?: string;
  /** Harness-owned exact native resume projection for trusted native ids. */
  readonly nativeConversationResume?: (nativeConversationId: string) => NativeConversationResume | undefined;
  /** Read this registration's native conversation identity from a trusted session. */
  readonly nativeConversationId?: (session: Pick<TerminalSession, 'claudeSessionId' | 'codexSessionId' | 'openCodeSessionId' | 'nativeConversationId'>) => string | undefined;
  /** Apply a trusted native identity through the narrow TerminalSession allowlist. */
  readonly nativeSessionPatch?: (nativeConversationId: string) => NativeSessionPatch | undefined;
  /**
   * Sync mint of a native conversation id at first spawn. PtyManager generates
   * the UUID and splices `spawnArgs(id)` — do not reuse Claude's `acceptsSessionId`
   * splice (Grok `--session-id` is create-only; Pi restore uses `--session`).
   */
  readonly nativeSessionMint?: {
    readonly spawnArgs: (id: string) => readonly string[];
  };
  /**
   * Async pre-spawn mint (Cursor `create-chat`). Host calls this before create();
   * failure is best-effort (launch continues without an exact id).
   */
  readonly prepareNativeSession?: (input: {
    readonly config: AppConfig;
    readonly cwd: string;
    readonly profile: LaunchProfileId;
  }) => Promise<{ readonly id: string } | undefined>;
  /** Build restore-only launch fields while preserving host-owned capability authority. */
  readonly restoreProjection?: (input: {
    readonly session: Pick<TerminalSession, 'profile' | 'claudeSessionId' | 'codexSessionId' | 'openCodeSessionId' | 'nativeConversationId'>;
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
