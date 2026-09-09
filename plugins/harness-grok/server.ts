import type { ZccPluginApi } from "@zana-ai/zcc-plugin-sdk";

/**
 * First-party CLI Agent (PTY) harness plugin. The declaration is the only
 * source of this family in pickers: disabling the plugin hides Grok Build
 * from CLI Agent surfaces. The host still authorizes cwd and spawns node-pty.
 */
export default function plugin(zcc: ZccPluginApi) {
  zcc.agents.experimental_registerPtyHarness({
    id: "grok",
    displayName: "Grok Build",
    icon: "./icons/grok.svg",
    profiles: [
      { id: 'grok', label: 'Grok Build' },
      { id: 'grok-resume', label: 'Grok Build (resume)' },
      { id: 'grok-yolo', label: 'Grok Build (unrestricted)' }
    ],
    enableConfigKey: 'harnessGrokEnabled',
  });
}
