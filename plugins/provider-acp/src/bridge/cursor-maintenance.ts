import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import {
  type ProviderHealthResult,
  type ProviderInstallationRunResult,
  type ProviderInstallationStatus,
  type ProviderUsage,
  type ProviderUsageResult,
  type ProviderUsageWindow,
  experimental_clampPercent as clampPercent,
  experimental_commandOutput as commandOutput,
  experimental_downloadedInstallerCommand as downloadedInstallerCommand,
  experimental_formatCommand as formatCommand,
  experimental_installationVerification as installationVerification,
  experimental_readCliVersion as readCliVersion,
  experimental_resolveExecutablePath as resolveExecutablePath,
  experimental_versionFrom as versionFrom,
} from "@zana-ai/zcc-plugin-sdk/provider-bridge";

const execFileAsync = promisify(execFile);
const CURSOR_EXECUTABLE = "cursor-agent";
const CURSOR_INSTALL_SCRIPT_URL = "https://cursor.com/install";
const CURSOR_USAGE_URL = "https://api2.cursor.sh/auth/usage";
const USAGE_FETCH_TIMEOUT_MS = 15_000;

export interface CursorMaintenanceDeps {
  homeDir?: string;
  fetchImpl?: typeof fetch;
  readAuthFile?: (path: string) => Promise<string>;
  readKeychain?: () => Promise<string | null>;
}

const cursorAuthSchema = z
  .object({
    accessToken: z.string().min(1).optional(),
    token: z.string().min(1).optional(),
    email: z.string().email().optional(),
    cachedEmail: z.string().email().optional(),
  })
  .passthrough();

export interface CursorAuthCredentials {
  accessToken: string;
  accountEmail: string | null;
}

function cursorUpdateCommand(): {
  command: string;
  args: string[];
  displayCommand: string;
} {
  const args = ["update"];
  return {
    command: CURSOR_EXECUTABLE,
    args,
    displayCommand: formatCommand(CURSOR_EXECUTABLE, args),
  };
}

function cursorInstallCommand() {
  return downloadedInstallerCommand(CURSOR_INSTALL_SCRIPT_URL);
}

export async function getCursorProviderInstallationStatus(): Promise<ProviderInstallationStatus> {
  const [resolvedExecutable, versionOutput] = await Promise.all([
    resolveExecutablePath(CURSOR_EXECUTABLE),
    commandOutput(CURSOR_EXECUTABLE, ["--version"]),
  ]);
  const installed = resolvedExecutable !== null || versionOutput !== null;
  const currentVersion = versionFrom(versionOutput);
  const actionKind = installed ? "update" : "install";
  return {
    executableName: CURSOR_EXECUTABLE,
    executablePath: resolvedExecutable,
    installed,
    installSource: installed ? "external" : "notInstalled",
    currentVersion,
    latestVersion: null,
    minimumSupportedVersion: null,
    npmPackageName: null,
    npmGlobalPackageVersion: null,
    installAction: {
      kind: actionKind,
      label: actionKind === "install" ? "Install" : "Update",
      command:
        actionKind === "install"
          ? cursorInstallCommand().displayCommand
          : cursorUpdateCommand().displayCommand,
    },
    needsUpdate: false,
    versionUnsupported: false,
  };
}

export async function getCursorProviderInstallationRun(
  action: "install" | "update",
): Promise<ProviderInstallationRunResult> {
  const status = await getCursorProviderInstallationStatus();
  if (status.installAction?.kind !== action) {
    return {
      available: false,
      message: `Cursor ${action} is no longer available on this host.`,
    };
  }
  return {
    available: true,
    command: action === "install" ? cursorInstallCommand() : cursorUpdateCommand(),
    verification: installationVerification(status, action),
  };
}

function healthResult(
  status: "ready" | "not_installed" | "unauthenticated" | "unknown",
  args: {
    accountEmail?: string | null;
    installedVersion?: string | null;
    statusMessage?: string | null;
  } = {},
): ProviderHealthResult {
  return {
    supported: true,
    health: {
      status,
      statusMessage: args.statusMessage ?? null,
      accountEmail: args.accountEmail ?? null,
      planLabel: null,
      installedVersion: args.installedVersion ?? null,
      minimumSupportedVersion: null,
      canInstall: true,
      canUpdate: status !== "not_installed",
      loginCommand: "cursor-agent login",
    },
  };
}

async function defaultReadKeychain(): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  try {
    const { stdout } = await execFileAsync(
      "security",
      ["find-generic-password", "-s", "cursor-access-token", "-w"],
      { timeout: 5_000 },
    );
    const token = stdout.trim();
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

export async function readCursorAuthCredentials(
  deps: CursorMaintenanceDeps = {},
): Promise<CursorAuthCredentials | null> {
  const homeDir = deps.homeDir ?? homedir();
  const authPath = join(homeDir, ".cursor", "auth.json");
  const readAuthFile = deps.readAuthFile ?? ((path: string) => readFile(path, "utf8"));
  try {
    const parsed = cursorAuthSchema.safeParse(JSON.parse(await readAuthFile(authPath)));
    if (parsed.success) {
      const accessToken = parsed.data.accessToken ?? parsed.data.token;
      if (accessToken) {
        return {
          accessToken,
          accountEmail: parsed.data.email ?? parsed.data.cachedEmail ?? null,
        };
      }
    }
  } catch {
    /* fall through to keychain */
  }
  const token = await (deps.readKeychain ?? defaultReadKeychain)();
  if (!token) return null;
  return { accessToken: token, accountEmail: null };
}

export async function getCursorProviderHealth(
  deps: CursorMaintenanceDeps = {},
): Promise<ProviderHealthResult> {
  if ((await resolveExecutablePath(CURSOR_EXECUTABLE)) === null) {
    return healthResult("not_installed");
  }
  const version = await readCliVersion(CURSOR_EXECUTABLE);
  try {
    const credentials = await readCursorAuthCredentials(deps);
    if (credentials === null) {
      return healthResult("unauthenticated", { installedVersion: version });
    }
    return healthResult("ready", {
      accountEmail: credentials.accountEmail,
      installedVersion: version,
    });
  } catch (error) {
    return healthResult("unknown", {
      installedVersion: version,
      statusMessage: error instanceof Error ? error.message : String(error),
    });
  }
}

const cursorUsageWindowSchema = z.object({
  name: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
  usedPercent: z.number().optional(),
  used_percent: z.number().optional(),
  resetsAt: z.string().min(1).nullable().optional(),
  reset_at: z.number().nullish(),
});

const cursorUsageResponseSchema = z
  .object({
    email: z.string().email().optional(),
    membershipType: z.string().optional(),
    plan: z.string().optional(),
    windows: z.array(cursorUsageWindowSchema).optional(),
    usage: z.array(cursorUsageWindowSchema).optional(),
  })
  .passthrough();

function usageWindow(
  value: z.infer<typeof cursorUsageWindowSchema>,
  index: number,
): ProviderUsageWindow {
  const used = value.usedPercent ?? value.used_percent ?? 0;
  const resetsAt =
    value.resetsAt
    ?? (value.reset_at == null || !Number.isFinite(value.reset_at)
      ? null
      : new Date(value.reset_at * 1000).toISOString());
  return {
    label: value.label ?? value.name ?? `Window ${index + 1}`,
    usedPercent: clampPercent(used),
    resetsAt,
  };
}

export function normalizeCursorUsage(
  raw: unknown,
  email: string | null,
): ProviderUsage {
  const parsed = cursorUsageResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message: "Cursor usage response was malformed.",
      planLabel: null,
      accountEmail: email,
    };
  }
  const windowsRaw = parsed.data.windows ?? parsed.data.usage;
  if (windowsRaw === undefined && parsed.data.membershipType === undefined && parsed.data.plan === undefined) {
    return {
      status: "error",
      message: "Cursor usage response was malformed.",
      planLabel: null,
      accountEmail: email,
    };
  }
  const windows = (windowsRaw ?? []).map(usageWindow);
  return {
    status: "ok",
    accountEmail: parsed.data.email ?? email,
    planLabel: parsed.data.membershipType ?? parsed.data.plan ?? null,
    windows,
  };
}

export async function getCursorProviderUsage(
  deps: CursorMaintenanceDeps = {},
): Promise<ProviderUsageResult> {
  if ((await resolveExecutablePath(CURSOR_EXECUTABLE)) === null) {
    return { supported: true, usage: { status: "not_installed" } };
  }
  const credentials = await readCursorAuthCredentials(deps);
  if (credentials === null) {
    return { supported: true, usage: { status: "unauthenticated" } };
  }
  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(CURSOR_USAGE_URL, {
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(USAGE_FETCH_TIMEOUT_MS),
    });
    if (response.status === 401) {
      return { supported: true, usage: { status: "expired" } };
    }
    if (!response.ok) {
      return {
        supported: true,
        usage: {
          status: "error",
          message: `Cursor usage request failed (HTTP ${response.status}).`,
          planLabel: null,
          accountEmail: credentials.accountEmail,
        },
      };
    }
    return {
      supported: true,
      usage: normalizeCursorUsage(await response.json(), credentials.accountEmail),
    };
  } catch (error) {
    return {
      supported: true,
      usage: {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
        planLabel: null,
        accountEmail: credentials.accountEmail,
      },
    };
  }
}

export function isCursorLaunchCommand(command: string | undefined): boolean {
  if (!command) return false;
  const base = command.split(/[/\\]/u).pop()?.toLowerCase() ?? "";
  return base === "cursor-agent" || base === "cursor-agent.exe";
}
