import { z } from 'zod';
import { isSafeTargetBranch, validateSquadExecutionTarget } from './product.js';

export type LaunchSettingSource = 'launch' | 'plan' | 'squad' | 'default';
export interface ResolvedLaunchSetting<T> { value: T; source: LaunchSettingSource }
export interface ExecutionResolvedLaunchV1 {
  worktree: ResolvedLaunchSetting<boolean>;
  onComplete: ResolvedLaunchSetting<'leave' | 'merge' | 'delete'>;
  push: ResolvedLaunchSetting<boolean>;
  checks: ResolvedLaunchSetting<readonly string[]>;
  failurePolicyDefault: ResolvedLaunchSetting<'fail-run'>;
}

const onCompleteSchema = z.enum(['leave', 'merge', 'delete']);
export const namedCheckReferenceSchema = z.string().max(100).regex(/^[A-Za-z_][A-Za-z0-9_-]*$/);
const checksSchema = z.array(namedCheckReferenceSchema).max(100);
const failurePolicySchema = z.literal('fail-run');
const branchSchema = z.string().min(1).max(200).refine(isSafeTargetBranch);
export const squadExecutionTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('project-root') }),
  z.strictObject({ kind: z.literal('worktree'), branch: branchSchema })
]);

export const planLaunchSchema = z.strictObject({
  worktree: z.boolean().optional(),
  onComplete: onCompleteSchema.optional(),
  push: z.boolean().optional(),
  checks: checksSchema.optional(),
  failurePolicyDefault: failurePolicySchema.optional()
});
export const launchOptionsSchema = planLaunchSchema.extend({ target: squadExecutionTargetSchema.optional() });
export const squadLaunchSchema = z.strictObject({
  worktreeIsolation: z.boolean().optional(),
  worktreeOnComplete: onCompleteSchema.optional(),
  push: z.boolean().optional(),
  checks: checksSchema.optional(),
  failurePolicyDefault: failurePolicySchema.optional()
});
export type PlanLaunch = z.infer<typeof planLaunchSchema>;
export type LaunchOptions = z.infer<typeof launchOptionsSchema>;
export type SquadLaunch = z.infer<typeof squadLaunchSchema>;

const launchSettingSourceSchema = z.enum(['launch', 'plan', 'squad', 'default']);
const settingSchema = <T extends z.ZodType>(value: T) => z.strictObject({ value, source: launchSettingSourceSchema });
export const resolvedLaunchSchema = z.strictObject({
  worktree: settingSchema(z.boolean()),
  onComplete: settingSchema(onCompleteSchema),
  push: settingSchema(z.boolean()),
  checks: settingSchema(checksSchema),
  failurePolicyDefault: settingSchema(failurePolicySchema)
});

export const squadLaunchLocationSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('project-root'), projectId: z.string().min(1) }),
  z.strictObject({ kind: z.literal('worktree'), projectId: z.string().min(1), branch: branchSchema, ownership: z.literal('user') }),
  z.strictObject({ kind: z.literal('new-worktree'), projectId: z.string().min(1), baseBranch: branchSchema, isolationSource: launchSettingSourceSchema })
]);
export type SquadLaunchLocation = z.infer<typeof squadLaunchLocationSchema>;

export function resolveLaunch<T>(input: {
  launch?: T;
  plan?: T;
  squad?: T;
  fallback?: T;
  default: T;
}): ResolvedLaunchSetting<T> {
  if (input.launch !== undefined) return { value: input.launch, source: 'launch' };
  if (input.plan !== undefined) return { value: input.plan, source: 'plan' };
  if (input.squad !== undefined) return { value: input.squad, source: 'squad' };
  return { value: input.fallback ?? input.default, source: 'default' };
}

export interface ResolveAllLaunchInput {
  launch?: LaunchOptions;
  plan?: PlanLaunch;
  squad?: SquadLaunch;
  /** Host-derived legacy project/global worktree fallback, not a new source tier. */
  fallback?: Pick<PlanLaunch, 'worktree'>;
}

export function resolveAllLaunch(input: ResolveAllLaunchInput): ExecutionResolvedLaunchV1 {
  const launch = launchOptionsSchema.parse(input.launch ?? {});
  const plan = planLaunchSchema.parse(input.plan ?? {});
  const squad = squadLaunchSchema.parse(input.squad ?? {});
  const targetValidation = validateSquadExecutionTarget(launch);
  if (!targetValidation.ok) throw new Error(targetValidation.message);
  const onComplete = resolveLaunch({ launch: launch.onComplete, plan: plan.onComplete, squad: targetValidation.target ? undefined : squad.worktreeOnComplete, default: 'leave' as const });
  const effectiveValidation = validateSquadExecutionTarget({ target: targetValidation.target, onComplete: onComplete.value });
  if (!effectiveValidation.ok) throw new Error(effectiveValidation.message);
  const checks = resolveLaunch<readonly string[]>({ launch: launch.checks, plan: plan.checks, squad: squad.checks, default: [] });
  return {
    worktree: targetValidation.target
      ? { value: false, source: 'launch' }
      : resolveLaunch({ launch: launch.worktree, plan: plan.worktree, squad: squad.worktreeIsolation, fallback: input.fallback?.worktree, default: false }),
    onComplete,
    push: resolveLaunch({ launch: launch.push, plan: plan.push, squad: squad.push, default: false }),
    checks: { ...checks, value: [...checks.value] },
    failurePolicyDefault: resolveLaunch({ launch: launch.failurePolicyDefault, plan: plan.failurePolicyDefault, squad: squad.failurePolicyDefault, default: 'fail-run' })
  };
}
