import { z } from 'zod';
import { CliCallbackGrantSchema } from './cli-callbacks.js';
import { ProjectSettingsPatchSchema } from './project-settings.js';

const settings = ProjectSettingsPatchSchema.shape;
const text = z.string().max(32_768);
const strings = z.array(text).max(256);
export const CliProfileSchema = z.enum([
  'claude', 'claude-resume', 'claude-yolo', 'cursor', 'cursor-resume', 'cursor-yolo',
  'codex', 'codex-resume', 'codex-yolo', 'pi', 'pi-resume',
  'opencode', 'opencode-resume', 'opencode-yolo', 'grok', 'grok-resume', 'grok-yolo',
  'mastracode', 'mastracode-resume', 'mastracode-yolo', 'afcode', 'afcode-resume', 'afcode-yolo'
]);

/** Shared launch preferences only. Binaries, environment, credentials, callback
 * destinations and machine configuration can never be supplied through this DTO. */
export const CliSharedConfigSchema = z.object({
  harnessRouting: settings.harnessRouting,
  claudeAppendSystemPrompt: text.optional(),
  claudeExtraArgs: strings.optional(),
  claudeAddDirs: strings.optional(),
  claudeAllowedTools: strings.optional(),
  claudeDeniedTools: strings.optional(),
  defaultCodexSandbox: settings.codexSandbox,
  defaultCodexApproval: settings.codexApproval,
  defaultPermissionMode: settings.permissionMode,
  defaultExecutionState: settings.executionState,
  defaultModel: z.string().max(4096).optional(),
  piProvider: settings.piProvider,
  piModel: settings.piModel,
  piThinking: settings.piThinking,
  autoModeEnabled: z.boolean().optional(),
  autoModeEnvironment: strings.optional(),
  autoModeAllow: strings.optional(),
  autoModeSoftDeny: strings.optional(),
  autoModeHardDeny: strings.optional(),
  autoModeClassifyAllShell: z.boolean().optional(),
  injectProductGuidance: z.boolean().optional(),
  injectRemoteInstructions: z.boolean().optional(),
  trustZccToolsEnabled: z.boolean().optional(),
  inAppAgentTerminalsEnabled: z.boolean().optional(),
  nativeAgentDiscoveryEnabled: z.boolean().optional(),
  askUserQuestionUiEnabled: z.boolean().optional(),
  overseerMode: z.enum(['off', 'dryRun', 'on']).optional(),
  contentScreenMode: z.enum(['off', 'dryRun', 'on']).optional()
}).strict();
export type CliSharedConfig = z.infer<typeof CliSharedConfigSchema>;

export const CliPersonaSchema = ProjectSettingsPatchSchema.pick({
  model: true, modelLevel: true, permissionMode: true, executionState: true,
  codexSandbox: true, codexApproval: true, appendSystemPrompt: true,
  allowedTools: true, deniedTools: true, addDirs: true, harnessRouting: true
}).extend({
  id: z.string().min(1).max(200), name: z.string().min(1).max(200),
  baseProfile: CliProfileSchema.optional(), initialPrompt: text.optional(),
  mcpServers: strings.optional()
}).strict();

/** Main authorizes the launch before sending this command. The host still
 * confines cwd and independently resolves its own executable and login. */
export const CliTerminalStartCommandSchema = z.object({
  type: z.literal('terminal.start_cli'),
  grant: CliCallbackGrantSchema,
  root: z.string().min(1).max(4096),
  cwd: z.string().min(1).max(4096).optional(),
  cols: z.number().int().min(20).max(300),
  rows: z.number().int().min(8).max(100),
  profile: CliProfileSchema,
  config: CliSharedConfigSchema,
  projectSettings: ProjectSettingsPatchSchema.omit({ worktreeIsolation: true, launchApproval: true, remoteToolProxy: true, microVmImage: true }).optional(),
  persona: CliPersonaSchema.optional(),
  harnessRouting: settings.harnessRouting,
  extraArgs: strings.optional(),
  title: z.string().max(200).optional(),
  rules: z.string().max(256 * 1024).optional(),
  openingPrompt: text.optional(),
  resumeSessionId: z.string().min(1).max(4096).optional(),
  autoCloseOnFinish: z.boolean().optional(),
  suppressPersonaInitialPrompt: z.boolean().optional(),
  headless: z.boolean().optional(),
  scheduled: z.boolean().optional(),
  autonomous: z.boolean().optional()
}).strict().refine(command => JSON.stringify(command).length <= 256 * 1024, 'CLI launch exceeds size limit');
export type CliTerminalStartCommand = z.infer<typeof CliTerminalStartCommandSchema>;
