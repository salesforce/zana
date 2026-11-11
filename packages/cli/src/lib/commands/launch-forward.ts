import { launchOptionsSchema, resolveAllLaunch, type LaunchOptions } from '@zana-ai/zcc-domain/launch-options';
import { flagValue, flagValues, hasFlag } from '../flag-parse.js';

export function launchOptionsFromFlags(args: string[]): LaunchOptions {
  const valueFlags = ['--on-complete', '--failure-policy-default', '--check', '--target'];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if ([...valueFlags, '--worktree', '--push'].some((flag) => arg === `${flag}=`)
      || (valueFlags.includes(arg) && (!args[i + 1] || args[i + 1]!.startsWith('--')))) {
      throw new Error(`${arg} requires a value`);
    }
  }
  const options: Record<string, unknown> = {};
  for (const key of ['worktree', 'push'] as const) {
    const flag = `--${key}`;
    const raw = flagValue(args, flag);
    if (raw !== undefined) {
      if (raw !== 'true' && raw !== 'false') throw new Error(`${flag} must be true or false`);
      options[key] = raw === 'true';
    } else if (hasFlag(args, flag)) options[key] = true;
    if (hasFlag(args, `--no-${key}`)) {
      if (key in options) throw new Error(`conflicting ${flag} flags`);
      options[key] = false;
    }
  }
  for (const [flag, key] of [['--on-complete', 'onComplete'], ['--failure-policy-default', 'failurePolicyDefault']] as const) {
    if (args.some((arg) => arg === flag || arg.startsWith(`${flag}=`))) {
      const value = flagValue(args, flag);
      if (value === undefined) throw new Error(`${flag} requires a value`);
      options[key] = value;
    }
  }
  const checks = flagValues(args, '--check');
  if (args.some((arg) => arg === '--check' || arg.startsWith('--check='))) {
    if (!checks.length) throw new Error('--check requires a named check');
    options.checks = checks;
  }
  const target = flagValue(args, '--target');
  if (target !== undefined) {
    if (target === 'project-root') options.target = { kind: 'project-root' };
    else if (target.startsWith('worktree:')) options.target = { kind: 'worktree', branch: target.slice('worktree:'.length) };
    else throw new Error('--target must be project-root or worktree:<branch>');
  } else if (hasFlag(args, '--target')) throw new Error('--target requires a selector');
  const parsed = launchOptionsSchema.parse(options);
  resolveAllLaunch({ launch: parsed });
  return parsed;
}
