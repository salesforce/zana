/** @param {import('@zana-ai/zcc-plugin-sdk').ZccPluginApi} zcc */
export default function plugin(zcc) {
  zcc.agents.experimental_registerPtyHarness({
    id: 'opencode',
    displayName: 'OpenCode',
    icon: './icons/opencode.svg',
    profiles: [
      { id: 'opencode', label: 'OpenCode' },
      { id: 'opencode-resume', label: 'OpenCode (resume)' },
      { id: 'opencode-yolo', label: 'OpenCode (unrestricted)' }
    ],
    enableConfigKey: 'harnessOpenCodeEnabled',
  });
}
