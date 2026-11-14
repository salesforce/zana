import { describe, expect, it } from "vitest";
import { __testing } from "./provider-maintenance.js";

function missingInstallationStatus() {
  return {
    executableName: "claude",
    executablePath: null,
    installed: false,
    installSource: "notInstalled" as const,
    currentVersion: null,
    latestVersion: "2.1.0",
    minimumSupportedVersion: null,
    npmPackageName: "@anthropic-ai/claude-code",
    npmGlobalPackageVersion: null,
    installAction: {
      kind: "install" as const,
      label: "Install" as const,
      command: "install Claude Code",
    },
    needsUpdate: false,
    versionUnsupported: false,
  };
}

describe("Claude Code provider maintenance", () => {
  it("normalizes aggregate and unique model-scoped usage windows", () => {
    const credentials = {
      accessToken: "token",
      expiresAt: null,
      subscriptionType: "pro",
      rateLimitTier: "max_5x",
    };
    expect(
      __testing.normalizeUsage(
        {
          five_hour: { utilization: 12.4, resets_at: "2026-01-02T03:04:05Z" },
          seven_day: { utilization: 55, resets_at: null },
          limits: [
            {
              kind: "weekly_scoped",
              scope: { model: { display_name: "Sonnet" } },
              percent: 30,
              resets_at: "2026-01-03T00:00:00Z",
            },
            {
              kind: "weekly_scoped",
              scope: { model: { display_name: "sonnet" } },
              percent: 80,
              resets_at: null,
            },
          ],
        },
        credentials,
        "claude@example.com",
      ),
    ).toMatchObject({
      status: "ok",
      accountEmail: "claude@example.com",
      planLabel: "Max (5x)",
      windows: [
        { label: "Current session", usedPercent: 12 },
        { label: "Weekly limit", usedPercent: 55 },
        { label: "Sonnet", usedPercent: 30 },
      ],
    });
  });

  it("updates an npm global install with npm install -g", () => {
    const run = __testing.buildProviderInstallationRun(
      {
        ...missingInstallationStatus(),
        installed: true,
        executablePath: "C:/npm/claude.cmd",
        installSource: "npmGlobal",
        currentVersion: "2.0.0",
        latestVersion: "2.1.0",
        needsUpdate: true,
        installAction: {
          kind: "update",
          label: "Update",
          command: "npm install -g @anthropic-ai/claude-code@latest",
        },
      },
      "update",
    );
    expect(run).toMatchObject({
      available: true,
      command: {
        command: process.platform === "win32" ? "npm.cmd" : "npm",
        args: ["install", "-g", "@anthropic-ai/claude-code@latest"],
        displayCommand: `${process.platform === "win32" ? "npm.cmd" : "npm"} install -g @anthropic-ai/claude-code@latest`,
      },
      verification: { kind: "version_at_least", version: "2.1.0" },
    });
  });

  it("updates an npm global install on the stable channel with @stable", () => {
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const displayCommand = `${npm} install -g @anthropic-ai/claude-code@stable`;
    const run = __testing.buildProviderInstallationRun(
      {
        ...missingInstallationStatus(),
        installed: true,
        executablePath: "C:/npm/claude.cmd",
        installSource: "npmGlobal",
        currentVersion: "2.0.0",
        latestVersion: "2.1.0",
        needsUpdate: true,
        installAction: {
          kind: "update",
          label: "Update",
          command: displayCommand,
        },
      },
      "update",
      "stable",
    );
    expect(run).toMatchObject({
      available: true,
      command: {
        command: npm,
        args: ["install", "-g", "@anthropic-ai/claude-code@stable"],
        displayCommand,
      },
      verification: { kind: "version_at_least", version: "2.1.0" },
    });
  });

  it("falls back to @latest when the auto-update channel is unknown", () => {
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const run = __testing.buildProviderInstallationRun(
      {
        ...missingInstallationStatus(),
        installed: true,
        executablePath: "C:/npm/claude.cmd",
        installSource: "npmGlobal",
        currentVersion: "2.0.0",
        latestVersion: "2.1.0",
        needsUpdate: true,
        installAction: {
          kind: "update",
          label: "Update",
          command: `${npm} install -g @anthropic-ai/claude-code@latest`,
        },
      },
      "update",
      null,
    );
    expect(run.available && run.command.args).toEqual([
      "install",
      "-g",
      "@anthropic-ai/claude-code@latest",
    ]);
    expect(run.available && run.command.displayCommand).toBe(
      `${npm} install -g @anthropic-ai/claude-code@latest`,
    );
  });

  it("uses the same npm update command for display and execution", () => {
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    for (const channel of ["latest", "stable", null] as const) {
      const tag = channel === "stable" ? "stable" : "latest";
      const execution = __testing.claudeUpdateExecution("npmGlobal", channel);
      const displayCommand = `${npm} install -g @anthropic-ai/claude-code@${tag}`;
      expect(execution.displayCommand).toBe(displayCommand);
      const run = __testing.buildProviderInstallationRun(
        {
          ...missingInstallationStatus(),
          installed: true,
          executablePath: "C:/npm/claude.cmd",
          installSource: "npmGlobal",
          currentVersion: "2.0.0",
          latestVersion: "2.1.0",
          needsUpdate: true,
          installAction: {
            kind: "update",
            label: "Update",
            command: execution.displayCommand,
          },
        },
        "update",
        channel,
      );
      expect(run).toMatchObject({
        available: true,
        command: execution,
      });
      expect(run.available && run.command.displayCommand).toBe(
        execution.displayCommand,
      );
    }
  });

  it("keeps claude update for a native install", () => {
    const run = __testing.buildProviderInstallationRun(
      {
        ...missingInstallationStatus(),
        installed: true,
        executablePath: "/Users/me/.local/bin/claude",
        installSource: "external",
        currentVersion: "2.0.0",
        latestVersion: "2.1.0",
        needsUpdate: true,
        installAction: {
          kind: "update",
          label: "Update",
          command: "claude update",
        },
      },
      "update",
    );
    expect(run).toMatchObject({
      available: true,
      command: { args: ["update"] },
    });
    expect(run.available && run.command.command).not.toMatch(/^npm(\.cmd)?$/u);
  });

  it("keeps the native installer plan private behind the run method", () => {
    const run = __testing.buildProviderInstallationRun(
      missingInstallationStatus(),
      "install",
    );
    expect(run).toMatchObject({
      available: true,
      command: { command: "sh" },
      verification: { kind: "installed" },
    });
    expect(run.available && run.command.args).toHaveLength(2);
    expect(run.available && run.command.args[1]).toContain(
      "https://claude.ai/install.sh",
    );
  });
});
