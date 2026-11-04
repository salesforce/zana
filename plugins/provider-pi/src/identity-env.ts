const IDENTITY_KEYS = ["ZCC_PROJECT_ID", "ZCC_ENVIRONMENT_ID"] as const;

/** The project and environment identity a Pi child was constructed with. */
export function pickPiIdentityEnv(
  env: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const key of IDENTITY_KEYS) {
    const value = env?.[key];
    if (value) picked[key] = value;
  }
  return picked;
}
