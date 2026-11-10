/** Variables that tell a spawned process which Zana thread, project and environment it belongs to. */
export const ZCC_IDENTITY_ENV_KEYS = [
  "ZCC_PROJECT_ID",
  "ZCC_THREAD_ID",
  "ZCC_ENVIRONMENT_ID",
] as const;

/** The identity variables present (and non-empty) in `env`. */
export function pickIdentityEnv(
  env: Readonly<Record<string, string | undefined>> | undefined,
): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const key of ZCC_IDENTITY_ENV_KEYS) {
    const value = env?.[key];
    if (value) picked[key] = value;
  }
  return picked;
}

/**
 * The identity a rebuilt session environment must keep: what the running
 * session already carries wins, and a per-turn override only fills a key the
 * session never had. A later turn can therefore never re-point a session at
 * another thread or project.
 */
export function resolveSessionIdentityEnv(
  current: Readonly<Record<string, string | undefined>> | undefined,
  overrides: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  return { ...pickIdentityEnv(overrides), ...pickIdentityEnv(current) };
}
