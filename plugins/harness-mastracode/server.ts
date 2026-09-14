import type { ZccPluginApi } from "@zana-ai/zcc-plugin-sdk";

/**
 * First-party CLI Agent (PTY) harness plugin. The declaration is the only
 * source of this family in pickers: disabling the plugin hides Mastra Code
 * from CLI Agent surfaces. The host still authorizes cwd and spawns node-pty.
 */
export default function plugin(zcc: ZccPluginApi) {
  zcc.agents.experimental_registerPtyHarness({
    id: "mastracode",
    displayName: "Mastra Code",
    icon: "./icons/mastracode.svg",
    profiles: [
      { id: 'mastracode', label: 'Mastra Code' },
      { id: 'mastracode-resume', label: 'Mastra Code (resume)' },
      { id: 'mastracode-yolo', label: 'Mastra Code (unrestricted)' }
    ],
    enableConfigKey: 'harnessMastracodeEnabled',
  });
}
