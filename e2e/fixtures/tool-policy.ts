/**
 * Native plugin tool policy fails closed (`plugin tool policy not ready: <id>`)
 * until every enabled server plugin that may own a tool policy has activated
 * and sealed. Plugins activate one at a time after boot, and the plugin-apps
 * snapshot is not a reliable proxy for that gate: it is empty until bundled
 * plugins are reconciled (and the IPC falls back to `[]` on error), so an
 * "every enabled plugin is running" poll can pass before activation begins.
 *
 * The deny is decided before any tool runs, so the gate itself is the only
 * truthful readiness signal: repeat the call while it reports not-ready.
 * Mirrors TOOL_POLICY_NOT_READY_REASON in
 * apps/server/src/plugins/plugin-tool-policy-state.ts.
 */
export const TOOL_POLICY_NOT_READY_REASON = 'plugin tool policy not ready';

export async function retryWhileToolPolicyNotReady<T>(
  call: () => Promise<T>,
  responseText: (result: T) => string,
  { timeoutMs = 90_000, intervalMs = 500 }: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await call();
    if (!responseText(result).includes(TOOL_POLICY_NOT_READY_REASON) || Date.now() >= deadline) return result;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
