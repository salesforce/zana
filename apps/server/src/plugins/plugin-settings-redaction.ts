/**
 * Drop every `secret: true` value and descriptor default from a plugin settings
 * snapshot, keeping public metadata. A default can itself be a credential.
 * Callers that only need labels and non-secret values (Settings
 * search) ask for this so stored secrets never cross to the renderer just to be
 * discarded there (Rule 1: the renderer is untrusted).
 *
 * Shared by BOTH renderer read paths, so they redact identically: the product
 * HTTP route (`GET /api/v1/plugin-apps/:id/settings?secrets=omit`) and the
 * desktop IPC handler (`pluginApps:getSettings` with `{ omitSecrets: true }`).
 */
export function withoutSecretValues<T extends { descriptors: Record<string, object>; values: Record<string, unknown> }>(
  snapshot: T
): T {
  const values = { ...snapshot.values };
  const descriptors = { ...snapshot.descriptors };
  for (const [key, descriptor] of Object.entries(snapshot.descriptors)) {
    if ((descriptor as { secret?: unknown }).secret !== true) continue;
    delete values[key];
    const publicDescriptor = { ...descriptor };
    delete (publicDescriptor as { default?: unknown }).default;
    descriptors[key] = publicDescriptor;
  }
  return { ...snapshot, descriptors, values };
}

/** The renderer-supplied read options, narrowed: only a literal `true` asks for redaction. */
export function wantsSecretsOmitted(options: unknown): boolean {
  return !!options && typeof options === 'object' && (options as { omitSecrets?: unknown }).omitSecrets === true;
}
