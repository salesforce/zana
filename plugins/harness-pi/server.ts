import type { ZccPluginApi } from "@zana-ai/zcc-plugin-sdk";

/**
 * First-party CLI Agent (PTY) harness plugin. The declaration is the only
 * source of this family in pickers: disabling the plugin hides Pi
 * from CLI Agent surfaces. The host still authorizes cwd and spawns node-pty.
 */
export default function plugin(zcc: ZccPluginApi) {
  zcc.agents.experimental_registerPtyHarness({
    id: "pi",
    displayName: "Pi",
    icon: "./icons/pi.svg",
    profiles: [
      { id: 'pi', label: 'Pi' },
      { id: 'pi-resume', label: 'Pi (resume)' }
    ],
    enableConfigKey: 'harnessPiEnabled',
  });
}
