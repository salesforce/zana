import { z } from 'zod';
import {
  defaultBranchRelationSchema,
  gitCheckoutRefSchema,
  workspaceGitOperationSchema
} from './git-checkout.js';
import { workspaceFileStatusSchema } from './workspace-diff.js';

export const WORKTREE_INCLUDE_FILE_NAME = '.worktreeinclude';
export const ENV_SETUP_SCRIPT_NAME = '.zcc-env-setup.sh';
export const MANAGED_WORKTREE_DIR_NAME = 'worktrees';
export const PERSONAL_WORKSPACE_DIR_NAME = 'personal-workspaces';
export const PROJECT_CHECKOUTS_DIR_NAME = 'checkouts';
export const LEGACY_WORKTREE_DIR_NAME = 'zcc-worktrees';
export const MANAGED_BRANCH_PREFIX = 'zcc';
export const DEFAULT_SETUP_TIMEOUT_MS = 15 * 60 * 1000;

export const environmentStatusValues = [
  'provisioning',
  'ready',
  'retiring',
  'failed',
  'destroying',
  'destroyed'
] as const;
export const environmentStatusSchema = z.enum(environmentStatusValues);
export type EnvironmentStatus = z.infer<typeof environmentStatusSchema>;

export const WORKSPACE_PROVISION_TYPES = ['unmanaged', 'managed-worktree', 'personal'] as const;
export const workspaceProvisionTypeSchema = z.enum(WORKSPACE_PROVISION_TYPES);
export type WorkspaceProvisionType = z.infer<typeof workspaceProvisionTypeSchema>;

export const environmentWorkspaceDisplayKindValues = [
  'managed-worktree',
  'unmanaged-worktree',
  'other'
] as const;
export const environmentWorkspaceDisplayKindSchema = z.enum(environmentWorkspaceDisplayKindValues);
export type EnvironmentWorkspaceDisplayKind = z.infer<typeof environmentWorkspaceDisplayKindSchema>;

export function resolveEnvironmentWorkspaceDisplayKind(environment: {
  isWorktree: boolean | null;
  workspaceProvisionType: WorkspaceProvisionType | null;
}): EnvironmentWorkspaceDisplayKind {
  if (environment.workspaceProvisionType === 'managed-worktree') return 'managed-worktree';
  if (environment.isWorktree === true) return 'unmanaged-worktree';
  return 'other';
}

export const provisioningTranscriptEntrySchema = z.object({
  type: z.enum(['step', 'output']),
  key: z.string().min(1),
  text: z.string(),
  status: z.enum(['started', 'completed', 'failed']).optional(),
  startedAt: z.number().int().nonnegative().optional()
}).strict();
export type ProvisioningTranscriptEntry = z.infer<typeof provisioningTranscriptEntrySchema>;

export const discoveredWorkspacePropertiesSchema = z.object({
  path: z.string().min(1),
  isGitRepo: z.boolean(),
  isWorktree: z.boolean(),
  branchName: z.string().nullable(),
  defaultBranch: z.string().nullable()
}).strict();
export type DiscoveredWorkspaceProperties = z.infer<typeof discoveredWorkspacePropertiesSchema>;

export const environmentSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullable(),
  projectId: z.string().min(1),
  hostId: z.string().min(1),
  path: z.string().nullable(),
  managed: z.boolean(),
  isGitRepo: z.boolean(),
  isWorktree: z.boolean(),
  workspaceProvisionType: workspaceProvisionTypeSchema,
  branchName: z.string().nullable(),
  baseBranch: z.string().nullable(),
  defaultBranch: z.string().nullable(),
  mergeBaseBranch: z.string().nullable(),
  status: environmentStatusSchema,
  createdAt: z.number(),
  updatedAt: z.number()
}).strict();
export type Environment = z.infer<typeof environmentSchema>;

export function resolveEnvironmentMergeBaseBranch(environment: {
  mergeBaseBranch?: string | null;
  baseBranch?: string | null;
  defaultBranch?: string | null;
} | null | undefined): string | undefined {
  return environment?.mergeBaseBranch ?? environment?.baseBranch ?? environment?.defaultBranch ?? undefined;
}

export function buildManagedBranchName(args: { threadId: string; branchSlug?: string | null }): string {
  const slug = args.branchSlug?.trim();
  return slug ? `${MANAGED_BRANCH_PREFIX}/${slug}-${args.threadId}` : `${MANAGED_BRANCH_PREFIX}/${args.threadId}`;
}

export const workspaceStatusSchema = z.object({
  path: z.string().min(1),
  isGitRepo: z.boolean(),
  isWorktree: z.boolean(),
  branchName: z.string().nullable(),
  defaultBranch: z.string().nullable(),
  defaultBranchRelation: defaultBranchRelationSchema.nullable(),
  originDefaultBranch: z.string().nullable(),
  checkout: gitCheckoutRefSchema,
  operation: workspaceGitOperationSchema,
  ahead: z.number().int().nonnegative().nullable(),
  behind: z.number().int().nonnegative().nullable(),
  dirty: z.boolean(),
  files: z.array(workspaceFileStatusSchema),
  filesTruncated: z.boolean()
}).strict();
export type WorkspaceStatus = z.infer<typeof workspaceStatusSchema>;

export const gitHostPullRequestMergeMethodSchema = z.enum(['merge', 'squash', 'rebase']);
export type GitHostPullRequestMergeMethod = z.infer<typeof gitHostPullRequestMergeMethodSchema>;

export const gitHostPullRequestSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  state: z.string().min(1),
  url: z.string().min(1),
  isDraft: z.boolean(),
  baseRefName: z.string().min(1),
  headRefName: z.string().min(1),
  updatedAt: z.string().nullable(),
  reviewDecision: z.string().nullable(),
  mergeStateStatus: z.string().nullable(),
  mergeable: z.string().nullable()
}).strict();
export type GitHostPullRequest = z.infer<typeof gitHostPullRequestSchema>;

export const environmentActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('commit'), message: z.string().min(1).max(2000).optional() }).strict(),
  z.object({
    action: z.literal('squash_merge'),
    targetBranch: z.string().min(1),
    message: z.string().min(1).max(2000).optional()
  }).strict(),
  z.object({ action: z.literal('pull_request_ready') }).strict(),
  z.object({ action: z.literal('pull_request_draft') }).strict(),
  z.object({
    action: z.literal('pull_request_merge'),
    method: gitHostPullRequestMergeMethodSchema
  }).strict(),
  z.object({
    action: z.literal('pull_request_create'),
    title: z.string().min(1).max(200).optional(),
    body: z.string().max(4000).optional(),
    base: z.string().min(1).optional(),
    draft: z.boolean().optional()
  }).strict()
]);
export type EnvironmentAction = z.infer<typeof environmentActionSchema>;

export const spawnEnvironmentChoiceSchema = z.union([
  z.object({ kind: z.literal('unmanaged') }).strict(),
  z.object({
    kind: z.literal('worktree'),
    branchSlug: z.string().min(1).max(80).optional(),
    baseBranch: z.string().min(1).optional()
  }).strict(),
  z.object({ kind: z.literal('personal') }).strict(),
  z.object({ kind: z.literal('reuse'), environmentId: z.string().uuid() }).strict()
]);
export type SpawnEnvironmentChoice = z.infer<typeof spawnEnvironmentChoiceSchema>;
