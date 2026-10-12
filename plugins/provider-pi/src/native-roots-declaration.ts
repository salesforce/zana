import type { PluginProviderDeclaration } from "@zana-ai/zcc-plugin-sdk";

// Server registration must also work from retained sources without SDK runtime imports.
export const PI_NATIVE_ROOTS_DECLARATION: Pick<
  PluginProviderDeclaration,
  "experimental_nativeSkillRoots" | "experimental_resolvesNativeRoots"
> = {
  experimental_nativeSkillRoots: {
    user: [".pi/agent/skills", ".agents/skills"],
    project: [".pi/skills", ".agents/skills"],
  },
  experimental_resolvesNativeRoots: true,
};
