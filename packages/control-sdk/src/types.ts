export const DEFAULT_PROD_URL = 'http://127.0.0.1:8780';
export const DEFAULT_DEV_URL = 'http://127.0.0.1:8781';

export const LIVE_TAG_PREFIX = 'zcc-live';
export const LIVE_SANDBOX_NAME = 'live-sandbox';

export type ProviderMode = 'live' | 'fake';

export type PermissionMode = 'accept-edits' | 'auto' | 'full';

export type SpawnEnvironmentChoice =
  | { kind: 'default' }
  | { kind: 'personal' }
  | { kind: 'worktree'; name?: string }
  | { kind: 'reuse'; environmentId: string };

export type InteractionPolicy = 'fail' | 'deny' | 'approve-safe';

export type ThreadWaitUntil = 'idle' | 'error' | 'quiet' | 'needs_you';

export type CliAgentWaitUntil = 'idle' | 'done' | 'exited' | 'working';

export type ModelLevel = 'low' | 'medium' | 'high' | 'extra-high';

export type ExecutionState = 'plan' | 'interactive' | 'accept-edits' | 'autonomous';

export interface ThreadLaunchSpec {
  surface: 'thread';
  projectId: string;
  prompt: string;
  providerId?: string;
  model?: string;
  acpMode?: string;
  permissionMode?: PermissionMode;
  reasoningLevel?: string;
  serviceTier?: 'default' | 'fast';
  environment?: SpawnEnvironmentChoice;
  hostId?: string;
  title?: string;
  parentThreadId?: string;
  visibility?: 'visible' | 'hidden';
}

export interface CliAgentLaunchSpec {
  surface: 'cli-agent';
  projectId: string;
  prompt: string;
  profile: string;
  personaId?: string;
  extraArgs?: string[];
  harnessRouting?: {
    schemaVersion: 1;
    byAdapter: Record<string, {
      roleTargetId?: string;
      modelTargetId?: string;
      providerTargetId?: string;
      modelLevel?: ModelLevel;
      executionState?: ExecutionState;
      executionTargetId?: string;
      compatibility?: { model?: string };
    }>;
  };
  worktree?: boolean | { branch?: string };
  executionEnvironment?: 'local' | 'sandbox' | 'microvm';
  isolateScratch?: boolean | string;
  title?: string;
}

export interface TeamLaunchSpec {
  surface: 'team';
  projectId: string;
  teamId: string;
  goal: string;
  mode: 'structured' | 'freeform';
}

export type LaunchSpec = ThreadLaunchSpec | CliAgentLaunchSpec | TeamLaunchSpec;

export interface ThreadRecord {
  id: string;
  projectId?: string;
  status?: string;
  title?: string | null;
  providerId?: string;
  hostId?: string;
  environmentId?: string | null;
  parentThreadId?: string | null;
  visibility?: string;
  activity?: { activeBackgroundCommandCount?: number };
}

export interface CliAgentRecord {
  id: string;
  projectId: string;
  profile: string;
  title?: string;
  status: string;
  pid?: number;
}

export interface HealthReport {
  ok: boolean;
  serverUrl: string;
  hostConnected: boolean;
}

export interface PendingInteraction {
  id: string;
  threadId?: string;
  title?: string;
  prompt?: string;
  type?: string;
}

export interface ConnectOptions {
  serverUrl?: string;
  dataDir?: string;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
  sleep?: (ms: number) => Promise<void>;
  provider?: ProviderMode;
  /** Required when both 8780 and 8781 answer, or to skip discovery. */
  runId?: string;
}

export interface IsolatedLaunchOptions extends ConnectOptions {
  isolated: true;
  repoRoot?: string;
  fake?: boolean;
}
