/** @param {import('@zana-ai/zcc-plugin-sdk').ZccPluginApi} zcc */
export default function plugin(zcc) {
  zcc.agents.experimental_registerPtyHarness({
    id: 'claude',
    displayName: 'Claude Code',
    icon: './icons/claude-code.svg',
    profiles: [
      { id: 'claude', label: 'Claude' },
      { id: 'claude-resume', label: 'Claude (resume)' },
      { id: 'claude-yolo', label: 'Claude (unrestricted)' }
    ],
    alwaysEnabled: true,
  });
}
