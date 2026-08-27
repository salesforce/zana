import { z } from 'zod';

const HarnessFamilySchema = z.enum(['claude', 'cursor', 'codex', 'pi', 'opencode']);
const ExecutionStateSchema = z.enum(['plan', 'interactive', 'accept-edits', 'autonomous']);
const ModelLevelSchema = z.enum(['low', 'medium', 'high', 'extra-high']);
const PermissionModeSchema = z.enum(['default', 'acceptEdits', 'plan', 'bypassPermissions']);
const CodexSandboxSchema = z.enum(['read-only', 'workspace-write', 'danger-full-access']);
const CodexApprovalSchema = z.enum(['untrusted', 'on-request', 'never']);
const PiThinkingSchema = z.enum(['default', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
const SettingStringSchema = z.string().max(32_768);
const TargetIdSchema = z.string().max(4_096);
const StringListSchema = z.array(SettingStringSchema).max(10_000);

const HarnessRoutingIntentSchema = z.object({
  providerTargetId: TargetIdSchema.optional(),
  roleTargetId: TargetIdSchema.optional(),
  modelTargetId: TargetIdSchema.optional(),
  modelLevel: ModelLevelSchema.optional(),
  executionTargetId: TargetIdSchema.optional(),
  executionState: ExecutionStateSchema.optional(),
  compatibility: z.object({
    codexSandbox: TargetIdSchema.optional(),
    codexApproval: TargetIdSchema.optional(),
    model: TargetIdSchema.optional(),
    permissionMode: TargetIdSchema.optional()
  }).strict().optional()
}).strict();

const HarnessRoutingSchema = z.object({
  schemaVersion: z.literal(1),
  byAdapter: z.partialRecord(HarnessFamilySchema, HarnessRoutingIntentSchema)
}).strict();

const HarnessCompatibilitySchema = z.object({
  model: TargetIdSchema.optional(),
  permissionMode: TargetIdSchema.optional(),
  appendSystemPrompt: SettingStringSchema.optional(),
  extraArgs: StringListSchema.optional(),
  addDirs: StringListSchema.optional(),
  allowedTools: StringListSchema.optional(),
  deniedTools: StringListSchema.optional(),
  codexSandbox: TargetIdSchema.optional(),
  codexApproval: TargetIdSchema.optional(),
  provider: TargetIdSchema.optional(),
  thinking: TargetIdSchema.optional()
}).strict();

const HarnessesSchema = z.object({
  byId: z.partialRecord(HarnessFamilySchema, z.object({
    compatibility: HarnessCompatibilitySchema.optional()
  }).strict()).optional()
}).strict();

/**
 * Bounded server-runtime input for the app-owned settings file. Existing
 * settings still carry a few intentionally opaque launch values, so the server
 * preserves unrecognized persisted fields while rejecting arbitrary IPC shapes.
 */
export const ProjectSettingsPatchSchema = z.object({
  appendSystemPrompt: SettingStringSchema.optional(),
  extraArgs: StringListSchema.optional(),
  addDirs: StringListSchema.optional(),
  allowedTools: StringListSchema.optional(),
  deniedTools: StringListSchema.optional(),
  piProvider: z.string().max(4_096).optional(),
  piModel: z.string().max(4_096).optional(),
  piThinking: PiThinkingSchema.optional(),
  model: z.string().max(4_096).optional(),
  modelLevel: ModelLevelSchema.optional(),
  permissionMode: PermissionModeSchema.optional(),
  executionState: ExecutionStateSchema.optional(),
  codexSandbox: CodexSandboxSchema.optional(),
  codexApproval: CodexApprovalSchema.optional(),
  worktreeIsolation: z.boolean().optional(),
  remoteToolProxy: z.boolean().optional(),
  microVmImage: z.string().max(4_096).optional(),
  harnessRouting: HarnessRoutingSchema.optional(),
  harnesses: HarnessesSchema.optional()
}).strict();

export type ProjectSettingsPatch = z.infer<typeof ProjectSettingsPatchSchema>;
