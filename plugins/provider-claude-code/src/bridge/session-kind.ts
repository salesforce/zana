import { homedir } from "node:os";
import { join } from "node:path";

export type ClaudeSessionKind = "interactive" | "automated";
export type ClaudeSessionAdmission =
  | "applied"
  | "default-interactive"
  /** Automated was requested but the isolated config dir could not be prepared or cannot authenticate. */
  | "fallback-interactive";

const DEFAULT_DATA_DIR_NAME = ".zcc";

/** Mirrors the host-daemon `resolveZccDataDir` precedence (the bridge cannot import it). */
export function resolveBridgeDataDir(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const explicit = env["ZCC_DATA_DIR"]?.trim() || env["ZCC_CENTER_DIR"]?.trim();
  return explicit || join(home, DEFAULT_DATA_DIR_NAME);
}

export function normalizeClaudeSessionKind(args: {
  requested: unknown;
}): { kind: ClaudeSessionKind; admission: ClaudeSessionAdmission } {
  if (args.requested !== "automated") {
    return { kind: "interactive", admission: "default-interactive" };
  }
  return { kind: "automated", admission: "applied" };
}
