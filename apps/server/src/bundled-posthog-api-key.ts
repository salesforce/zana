export function resolvePosthogApiKey(input?: {
  env?: NodeJS.ProcessEnv;
  bundledKey?: string | null;
}): string {
  const env = input?.env ?? process.env;
  const fromEnv = env.ZCC_POSTHOG_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const bundled = input && 'bundledKey' in input
    ? input.bundledKey?.trim()
    : (typeof __ZCC_BUNDLED_POSTHOG_API_KEY__ === 'string' ? __ZCC_BUNDLED_POSTHOG_API_KEY__.trim() : undefined);
  return bundled || '';
}

/** Copy the baked key onto `process.env` so in-process plugins can read it. Runtime env wins. */
export function applyBundledPosthogApiKey(
  env: NodeJS.ProcessEnv = process.env,
  opts?: { bundledKey?: string | null }
): string {
  const key = resolvePosthogApiKey(opts ? { env, bundledKey: opts.bundledKey } : { env });
  if (key) env.ZCC_POSTHOG_API_KEY = key;
  return key;
}
