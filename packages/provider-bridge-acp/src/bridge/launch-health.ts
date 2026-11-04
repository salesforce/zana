import { runPortableCommand } from "@zana-ai/zcc-agent-process-utils";
import { stat } from "node:fs/promises";
import type { ProviderHealth } from "@zana-ai/zcc-provider-bridge-protocol";
import { versionFrom, withoutBridgeRuntimeEnv } from "@zana-ai/zcc-provider-bridge-protocol/bridge-kit";

const PROBE_TIMEOUT_MS = 5_000;
const PROBE_OUTPUT_MAX_BYTES = 64 * 1024;
const DIAGNOSTIC_MAX_CHARS = 2_048;

export interface AcpLaunchHealthOptions {
  command: string | null;
  cwd?: string;
  env?: Record<string, string>;
}

export interface AcpLaunchHealthDeps {
  runCommand: typeof runPortableCommand;
}

type AcpLaunchHealthResult = { supported: false } | {
  supported: true;
  health: ProviderHealth & { status: "ready" | "not_installed" | "unknown" };
};

/** Probe the same command, environment and working directory used by ACP. */
export async function getAcpLaunchHealth(
  options: AcpLaunchHealthOptions,
  deps: AcpLaunchHealthDeps = { runCommand: runPortableCommand },
): Promise<AcpLaunchHealthResult> {
  const { command } = options;
  if (command === null || command.trim().length === 0) return { supported: false };
  let status: "ready" | "not_installed" | "unknown" = "unknown";
  let installedVersion: string | null = null;
  let statusMessage: string | null = null;
  try {
    if (command.includes("\0") || /[\r\n]/u.test(command)) {
      throw new Error("The launch command must be a single executable name or path.");
    }
    const output = await deps.runCommand(command, ["--version"], {
      timeout: PROBE_TIMEOUT_MS,
      maxBuffer: PROBE_OUTPUT_MAX_BYTES,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      env: { ...withoutBridgeRuntimeEnv(process.env), ...options.env },
    });
    status = "ready";
    installedVersion = versionFrom(`${output.stdout}\n${output.stderr}`);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    // ENOENT may name a missing cwd; keep that distinct from an absent CLI.
    const cwdExists = options.cwd === undefined || await stat(options.cwd).then(entry => entry.isDirectory(), () => false);
    status = code === "ENOENT" && cwdExists ? "not_installed" : "unknown";
    let detail = error instanceof Error ? error.message : "Executable probe failed.";
    // Wrappers sometimes print credentials. Do not echo configured env values.
    const secretValues = Object.entries(process.env).flatMap(([key, value]) =>
      /TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL|PRIVATE_KEY/iu.test(key) && value && value.length >= 8 ? [value] : []);
    for (const value of [...secretValues, ...Object.values(options.env ?? {})].sort((a, b) => b.length - a.length)) {
      if (value.length > 0) detail = detail.split(value).join("[redacted]");
    }
    detail = detail.replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, "").slice(0, DIAGNOSTIC_MAX_CHARS);
    const identity = JSON.stringify(command).slice(0, DIAGNOSTIC_MAX_CHARS);
    statusMessage = `ACP command ${identity} failed its --version check: ${detail} Check the executable and its dependencies on this host.`;
  }
  return {
    supported: true,
    health: {
      status,
      statusMessage,
      accountEmail: null,
      planLabel: null,
      installedVersion,
      minimumSupportedVersion: null,
      canInstall: false,
      canUpdate: false,
      loginCommand: null,
    },
  };
}
