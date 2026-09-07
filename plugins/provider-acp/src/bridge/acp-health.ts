import {
  type ProviderHealthResult,
  experimental_readCliVersion as readCliVersion,
  experimental_resolveExecutablePath as resolveExecutablePath,
} from "@zana-ai/zcc-plugin-sdk/provider-bridge";

function healthResult(args: {
  status: "ready" | "not_installed" | "unknown";
  installedVersion?: string | null;
  statusMessage?: string | null;
}): ProviderHealthResult {
  return {
    supported: true,
    health: {
      status: args.status,
      statusMessage: args.statusMessage ?? null,
      accountEmail: null,
      planLabel: null,
      installedVersion: args.installedVersion ?? null,
      minimumSupportedVersion: null,
      canInstall: false,
      canUpdate: false,
      loginCommand: null,
    },
  };
}

export interface GenericAcpHealthDeps {
  resolveExecutablePath: (command: string) => Promise<string | null>;
  readCliVersion: (command: string) => Promise<string | null>;
}

const defaultDeps: GenericAcpHealthDeps = {
  resolveExecutablePath,
  readCliVersion,
};

/** Presence-only health for ACP agents that have no Cursor-style account probe. */
export async function getGenericAcpProviderHealth(
  command: string | null,
  deps: GenericAcpHealthDeps = defaultDeps,
): Promise<ProviderHealthResult> {
  if (command === null || command.trim().length === 0) {
    return { supported: false };
  }
  const resolved = await deps.resolveExecutablePath(command);
  if (resolved !== null) {
    return healthResult({
      status: "ready",
      installedVersion: await deps.readCliVersion(command),
    });
  }
  // `which` can miss a binary `execFile --version` still runs (PATH repair,
  // PATHEXT, or a configured absolute name). Match family verify.
  const version = await deps.readCliVersion(command);
  if (version !== null) {
    return healthResult({ status: "ready", installedVersion: version });
  }
  return healthResult({ status: "not_installed" });
}
