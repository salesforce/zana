import path from "node:path";
import { open } from "node:fs/promises";
import type { PluginProviderDeclaration } from "@zana-ai/zcc-plugin-sdk";
import {
  experimental_filterResolvedNativeRoots,
  experimental_resolveClaudePluginRoots,
  type ExperimentalClaudePluginRoots,
  type ExperimentalClaudePluginRootsArgs,
  type ExperimentalVendorPluginRoots,
} from "@zana-ai/zcc-plugin-sdk/host";

export const CLAUDE_NATIVE_ROOTS_DECLARATION: Pick<
  PluginProviderDeclaration,
  | "experimental_nativeSkillRoots"
  | "experimental_nativeCommandRoots"
  | "experimental_resolvesNativeRoots"
> = {
  experimental_nativeSkillRoots: {
    user: [
      { path: ".claude/skills", skipIfManifest: ".claude-plugin/plugin.json" },
    ],
    project: [
      {
        path: ".claude/skills",
        ancestors: true,
        skipIfManifest: ".claude-plugin/plugin.json",
      },
    ],
  },
  experimental_nativeCommandRoots: {
    project: [".claude/commands"],
  },
  experimental_resolvesNativeRoots: true,
};

const CLAUDE_PLUGIN_MANIFEST_MARKER = ".claude-plugin/plugin.json";

type ClaudeResolvedRoot = ExperimentalVendorPluginRoots["skills"][number];

export function filterClaudeNativeRoots(
  plugins: ExperimentalClaudePluginRoots,
  warn: (message: string) => void,
): ExperimentalVendorPluginRoots {
  const userSkillsRoot: ClaudeResolvedRoot = {
    path: path.join(plugins.claudeDir, "skills"),
    origin: "user",
    shape: "skills",
    skipIfManifest: CLAUDE_PLUGIN_MANIFEST_MARKER,
  };
  const userCommandsRoot: ClaudeResolvedRoot = {
    path: path.join(plugins.claudeDir, "commands"),
    origin: "user",
    shape: "commands",
  };

  return experimental_filterResolvedNativeRoots(
    {
      skills: [
        userSkillsRoot,
        ...plugins.skills.filter((root) => root.path !== userSkillsRoot.path),
      ],
      commands: [
        userCommandsRoot,
        ...plugins.commands.filter(
          (root) => root.path !== userCommandsRoot.path,
        ),
      ],
    },
    { warn },
  ).answer;
}

export async function resolveClaudeNativeRoots(
  args: ExperimentalClaudePluginRootsArgs,
): Promise<ExperimentalVendorPluginRoots & { disabledSkillNames?: string[] }> {
  const plugins = await experimental_resolveClaudePluginRoots(args);
  const roots = filterClaudeNativeRoots(plugins, console.warn);
  // Keep settings on the execution host; the product server may be on another machine.
  const file = await open(path.join(plugins.claudeDir, "settings.json"), "r").catch(() => null);
  if (!file) return roots;
  try {
    const buffer = Buffer.alloc(256 * 1024 + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead === buffer.length) throw new Error("Skill settings exceed 256 KiB");
    const settings = JSON.parse(buffer.subarray(0, bytesRead).toString("utf8"));
    const overrides = settings?.skillOverrides;
    const disabledSkillNames = overrides && typeof overrides === "object" && !Array.isArray(overrides)
      ? Object.entries(overrides).filter(([, value]) => value === "off").map(([name]) => name).slice(0, 1000)
      : [];
    return { ...roots, disabledSkillNames };
  } catch (error) {
    // A broken settings file must be visible to the caller rather than silently claiming everything is enabled.
    throw new Error(`Could not read skill settings: ${error instanceof Error ? error.message : String(error)}`);
  } finally { await file.close(); }
}
