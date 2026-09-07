export type AcpDeclaredFork = "none" | "tip" | "checkpoint";

/**
 * Narrow an ACP agent's advertised fork capability. Never widen: a provider
 * declared `none` stays `none` even if the agent later advertises fork.
 */
export function narrowAcpForkCapability(args: {
  declared: AcpDeclaredFork;
  agentAdvertisesFork: boolean;
}): AcpDeclaredFork {
  if (args.declared === "none") return "none";
  if (args.declared === "checkpoint") return "checkpoint";
  return args.agentAdvertisesFork ? "tip" : "none";
}

export function agentAdvertisesSessionFork(initializeResult: {
  agentCapabilities?: {
    sessionCapabilities?: { fork?: unknown } | null;
  } | null;
}): boolean {
  return initializeResult.agentCapabilities?.sessionCapabilities?.fork != null;
}
