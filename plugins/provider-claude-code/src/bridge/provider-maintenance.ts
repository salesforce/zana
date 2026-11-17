import { resolveSettings, type AccountInfo } from "@anthropic-ai/claude-agent-sdk";
import { withInitializedClaude } from "./initialization-probe.js";
import {
  type ProviderHealthResult,
  type ProviderInstallationRunResult,
  type ProviderInstallationStatus,
  type ProviderUsage,
  type ProviderUsageResult,
  type ProviderUsageWindow,
  experimental_clampPercent as clampPercent,
  experimental_commandOutput as commandOutput,
  experimental_compareVersions as compareVersions,
  experimental_downloadedInstallerCommand as downloadedInstallerCommand,
  experimental_formatCommand as formatCommand,
  experimental_installationVerification as installationVerification,
  experimental_npmCommand as npmCommand,
  experimental_npmGlobalInstallCommand as npmGlobalInstallCommand,
  experimental_npmGlobalInstallSource as npmGlobalInstallSource,
  experimental_probeNpmGlobalPackage as probeNpmGlobalPackage,
  experimental_readCliVersion as readCliVersion,
  experimental_resolveExecutablePath as resolveExecutablePath,
  experimental_versionFrom as versionFrom,
} from "@zana-ai/zcc-plugin-sdk/provider-bridge";
import { z } from "zod";

const CLAUDE_NPM_PACKAGE = "@anthropic-ai/claude-code";
const CLAUDE_INSTALL_SCRIPT_URL = "https://claude.ai/install.sh";

function claudeExecutable(): string {
  return process.env.ZCC_CLAUDE_CODE_EXECUTABLE?.trim() || process.env.BB_CLAUDE_CODE_EXECUTABLE?.trim() || "claude";
}

function claudeDistTags(value: string | null): {
  latest: string;
  stable: string | null;
} | null {
  if (value === null) return null;
  try {
    const parsed = z
      .object({
        latest: z.string().min(1),
        stable: z.string().min(1).optional(),
      })
      .safeParse(JSON.parse(value));
    if (!parsed.success) return null;
    const latest = versionFrom(parsed.data.latest);
    if (latest === null) return null;
    return {
      latest,
      stable:
        parsed.data.stable === undefined
          ? latest
          : versionFrom(parsed.data.stable),
    };
  } catch {
    return null;
  }
}

function claudeDoctor(value: string | null): {
  installMethod: "native" | "npm-global" | "package-manager" | "unknown" | null;
  updateChannel: "latest" | "stable" | null;
} {
  const running =
    value === null ? null : /^Running:\s+([^\s(]+)/mu.exec(value)?.[1];
  const channel =
    value === null
      ? null
      : /^Auto-update channel:\s+(latest|stable)\s*$/mu.exec(value)?.[1];
  return {
    installMethod:
      running === "native" || running === "npm-global"
        ? running
        : running !== null && running !== undefined
          ? ["homebrew", "winget", "apt", "dnf", "apk"].includes(running)
            ? "package-manager"
            : "unknown"
          : null,
    updateChannel:
      channel === "latest" || channel === "stable" ? channel : null,
  };
}

function claudeNpmDistTag(
  updateChannel: "latest" | "stable" | null,
): "latest" | "stable" {
  return updateChannel === "stable" ? "stable" : "latest";
}

function claudeUpdateExecution(
  installSource: ProviderInstallationStatus["installSource"],
  updateChannel: "latest" | "stable" | null = null,
  nodePlatform: NodeJS.Platform = process.platform,
) {
  if (installSource === "npmGlobal" && nodePlatform === "win32") {
    return npmGlobalInstallCommand(CLAUDE_NPM_PACKAGE, claudeNpmDistTag(updateChannel));
  }
  const command = claudeExecutable();
  return {
    command,
    args: ["update"],
    displayCommand: formatCommand(command, ["update"]),
  };
}

function isDefaultNativeClaudePath(executablePath: string | null): boolean {
  if (executablePath === null) return false;
  const normalized = executablePath.replace(/\\/gu, "/");
  return (
    normalized.endsWith("/.local/bin/claude") ||
    (process.platform === "win32" &&
      normalized.endsWith("/.local/bin/claude.exe"))
  );
}

async function inspectClaudeInstallation(): Promise<{
  status: ProviderInstallationStatus;
  updateChannel: "latest" | "stable" | null;
}> {
  const command = claudeExecutable();
  const [
    resolvedExecutable,
    versionOutput,
    tagsOutput,
    npmGlobal,
    doctorOutput,
  ] = await Promise.all([
    resolveExecutablePath(command),
    commandOutput(command, ["--version"]),
    commandOutput(npmCommand(), [
      "view",
      CLAUDE_NPM_PACKAGE,
      "dist-tags",
      "--json",
    ]),
    probeNpmGlobalPackage(CLAUDE_NPM_PACKAGE),
    commandOutput(command, ["doctor"]),
  ]);
  const installed = resolvedExecutable !== null || versionOutput !== null;
  const currentVersion = versionFrom(versionOutput);
  const doctor = claudeDoctor(doctorOutput);
  const tags = claudeDistTags(tagsOutput);
  const latestVersion =
    doctor.updateChannel === null || tags === null
      ? null
      : tags[doctor.updateChannel];
  const definitelyNeedsUnknownChannelUpdate =
    installed &&
    currentVersion !== null &&
    tags?.stable !== null &&
    tags?.stable !== undefined &&
    compareVersions(tags.latest, currentVersion) > 0 &&
    compareVersions(tags.stable, currentVersion) > 0;
  const needsUpdate =
    installed && currentVersion !== null && latestVersion !== null
      ? compareVersions(latestVersion, currentVersion) > 0
      : definitelyNeedsUnknownChannelUpdate;
  const installSource = npmGlobalInstallSource({
    installed,
    executablePath: resolvedExecutable,
    npmBin: npmGlobal.npmBin,
  });
  const nativeFallback =
    doctor.installMethod === null &&
    installSource === "external" &&
    isDefaultNativeClaudePath(resolvedExecutable);
  const canRunUpdate =
    doctor.installMethod === "native" ||
    nativeFallback ||
    (installSource === "npmGlobal" &&
      (doctor.installMethod === null || doctor.installMethod === "npm-global"));
  const actionKind = !installed
    ? "install"
    : needsUpdate && canRunUpdate
      ? "update"
      : null;
  const displayCommand =
    actionKind === "install"
      ? downloadedInstallerCommand(CLAUDE_INSTALL_SCRIPT_URL).displayCommand
      : claudeUpdateExecution(installSource, doctor.updateChannel).displayCommand;
  return {
    status: {
      executableName: command,
      executablePath: resolvedExecutable,
      installed,
      installSource,
      currentVersion,
      latestVersion,
      minimumSupportedVersion: null,
      npmPackageName: CLAUDE_NPM_PACKAGE,
      npmGlobalPackageVersion: npmGlobal.npmGlobalPackageVersion,
      installAction:
        actionKind === null
          ? null
          : {
              kind: actionKind,
              label: actionKind === "install" ? "Install" : "Update",
              command: displayCommand,
            },
      needsUpdate,
      versionUnsupported: false,
    },
    updateChannel: doctor.updateChannel,
  };
}

export async function getClaudeProviderInstallationStatus(): Promise<ProviderInstallationStatus> {
  return (await inspectClaudeInstallation()).status;
}

export async function getClaudeProviderInstallationRun(
  action: "install" | "update",
): Promise<ProviderInstallationRunResult> {
  const { status, updateChannel } = await inspectClaudeInstallation();
  return buildClaudeProviderInstallationRun(status, action, updateChannel);
}

function buildClaudeProviderInstallationRun(
  status: ProviderInstallationStatus,
  action: "install" | "update",
  updateChannel: "latest" | "stable" | null = null,
  nodePlatform: NodeJS.Platform = process.platform,
): ProviderInstallationRunResult {
  if (status.installAction?.kind !== action) {
    return {
      available: false,
      message: `Claude Code ${action} is no longer available on this host.`,
    };
  }
  const execution =
    action === "install"
      ? downloadedInstallerCommand(CLAUDE_INSTALL_SCRIPT_URL)
      : claudeUpdateExecution(status.installSource, updateChannel, nodePlatform);
  return {
    available: true,
    command: execution,
    verification: installationVerification(status, action),
  };
}

function accountFields(account: AccountInfo) {
  const subscription = account.subscriptionType;
  return {
    accountEmail: account.email ?? null,
    planLabel: subscription ? subscription.charAt(0).toUpperCase() + subscription.slice(1) : null,
  };
}

function accountStatus(account: AccountInfo): "ready" | "unauthenticated" | "unknown" {
  // External providers own authentication; absent OAuth fields are normal there.
  if (account.apiProvider && account.apiProvider !== "firstParty") return "ready";
  const sources = [account.tokenSource, account.apiKeySource];
  if (sources.some((source) => source && source !== "none")) return "ready";
  return sources.some((source) => source === "none") ? "unauthenticated" : "unknown";
}

async function hasManagedAuthenticationSettings(): Promise<boolean> {
  const { effective } = await resolveSettings({ cwd: process.cwd(), settingSources: ['user', 'project', 'local'] });
  const env = { ...effective.env, ...process.env };
  return Boolean(effective.apiKeyHelper?.trim() ||
    ['ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'].some((key) => env[key]?.trim()) ||
    ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'].some((key) => ['1', 'true'].includes(env[key] ?? '')));
}

function healthResult(
  status: "ready" | "not_installed" | "unauthenticated" | "expired" | "unknown",
  args: {
    accountEmail?: string | null;
    planLabel?: string | null;
    installedVersion?: string | null;
    statusMessage?: string | null;
    loginCommand?: string | null;
  } = {},
): ProviderHealthResult {
  return {
    supported: true,
    health: {
      status,
      statusMessage: args.statusMessage ?? null,
      accountEmail: args.accountEmail ?? null,
      planLabel: args.planLabel ?? null,
      installedVersion: args.installedVersion ?? null,
      minimumSupportedVersion: null,
      canInstall: true,
      canUpdate: status !== "not_installed",
      loginCommand: args.loginCommand === undefined ? "claude auth login" : args.loginCommand,
    },
  };
}

export async function getClaudeProviderHealth(): Promise<ProviderHealthResult> {
  const command = claudeExecutable();
  if ((await resolveExecutablePath(command)) === null) {
    return healthResult("not_installed");
  }
  const version = await readCliVersion(command);
  try {
    return await withInitializedClaude(async (_session, { account }) => {
      const external = account.apiProvider && account.apiProvider !== "firstParty";
      const status = accountStatus(account);
      const managed = external || account.apiKeySource === 'apiKeyHelper' ||
        (status === 'unauthenticated' && await hasManagedAuthenticationSettings());
      return healthResult(managed && status === 'unauthenticated' ? 'unknown' : status, {
        ...accountFields(account), installedVersion: version,
        ...(managed ? {
          loginCommand: null,
          statusMessage: status === 'unauthenticated'
            ? 'Check the configured gateway or credential helper on this machine.'
            : account.apiProvider === "gateway"
            ? "Enterprise gateway credentials configured."
            : "Provider-managed credentials configured.",
        } : {}),
      });
    });
  } catch {
    return healthResult("unknown", {
      installedVersion: version,
      statusMessage: "Could not verify Claude credentials. Existing provider settings are unchanged.",
    });
  }
}

const claudeUsageWindowSchema = z.object({
  utilization: z.number().nullish(),
  resets_at: z.string().nullish(),
});

const claudeScopedUsageLimitSchema = z
  .object({
    kind: z.string(),
    scope: z
      .object({
        model: z
          .object({ display_name: z.string().trim().min(1).nullish() })
          .nullish(),
        surface: z.null().optional(),
      })
      .nullish(),
    percent: z.number().nullish(),
    resets_at: z.string().nullish(),
  })
  .passthrough();

const claudeUsageResponseSchema = z
  .object({
    five_hour: claudeUsageWindowSchema.nullish(),
    seven_day: claudeUsageWindowSchema.nullish(),
    limits: z
      .array(claudeScopedUsageLimitSchema.nullable().catch(null))
      .nullish()
      .catch([]),
  })
  .passthrough();

function resetIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function usageWindow(
  value: z.infer<typeof claudeUsageWindowSchema> | null | undefined,
  label: string,
): ProviderUsageWindow | null {
  if (!value || value.utilization == null) return null;
  return {
    label,
    usedPercent: clampPercent(value.utilization),
    resetsAt: resetIso(value.resets_at),
  };
}

function scopedWindows(
  limits:
    | (z.infer<typeof claudeScopedUsageLimitSchema> | null)[]
    | null
    | undefined,
): ProviderUsageWindow[] {
  const windows: ProviderUsageWindow[] = [];
  const seen = new Set<string>();
  for (const limit of limits ?? []) {
    const label = limit?.scope?.model?.display_name;
    if (
      limit == null ||
      limit.kind !== "weekly_scoped" ||
      label == null ||
      limit.percent == null ||
      seen.has(label.toLowerCase())
    ) {
      continue;
    }
    seen.add(label.toLowerCase());
    windows.push({
      label,
      usedPercent: clampPercent(limit.percent),
      resetsAt: resetIso(limit.resets_at),
    });
  }
  return windows;
}

function normalizeUsage(
  raw: unknown,
  account: AccountInfo,
): ProviderUsage {
  const parsed = claudeUsageResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message: "Claude usage response was malformed.",
      ...accountFields(account),
    };
  }
  const windows = [
    usageWindow(parsed.data.five_hour, "Current session"),
    usageWindow(parsed.data.seven_day, "Weekly limit"),
    ...scopedWindows(parsed.data.limits),
  ].filter((window): window is ProviderUsageWindow => window !== null);
  return {
    status: "ok",
    ...accountFields(account),
    windows,
  };
}

export async function getClaudeProviderUsage(): Promise<ProviderUsageResult> {
  const command = claudeExecutable();
  if ((await resolveExecutablePath(command)) === null) {
    return { supported: true, usage: { status: "not_installed" } };
  }
  try {
    return await withInitializedClaude(async (session, { account }) => {
      // Subscription usage is not applicable to enterprise gateways or API keys.
      // In particular, never send a gateway credential to a public OAuth endpoint.
      if ((account.apiProvider && account.apiProvider !== "firstParty") ||
          (account.apiKeySource && account.apiKeySource !== "none") || await hasManagedAuthenticationSettings()) {
        return { supported: true, usage: {
          status: "error", message: "Subscription usage is unavailable for this provider-managed account.",
          ...accountFields(account),
        } };
      }
      if (accountStatus(account) === "unauthenticated") {
        return { supported: true, usage: { status: "unauthenticated" } };
      }
      const usage = await session.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true });
      return { supported: true, usage: usage.rate_limits_available && usage.rate_limits
        ? normalizeUsage(usage.rate_limits, account)
        : { status: "error", message: "Subscription usage is unavailable for these credentials.", ...accountFields(account) },
      };
    });
  } catch {
    return { supported: true, usage: {
      status: "error", message: "Claude Code could not read account usage. Try checking again later.",
      accountEmail: null, planLabel: null,
    } };
  }
}

export const __testing = {
  buildProviderInstallationRun: buildClaudeProviderInstallationRun,
  claudeUpdateExecution,
  normalizeUsage,
};
