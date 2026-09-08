/** @param {import('@zana-ai/zcc-plugin-sdk').ZccPluginApi} zcc */
export default function plugin(zcc) {
  zcc.agents.experimental_registerPtyHarness({
    id: 'codex',
    displayName: 'Codex',
    icon: './icons/codex.svg',
    profiles: [
      { id: 'codex', label: 'Codex' },
      { id: 'codex-resume', label: 'Codex (resume)' },
      { id: 'codex-yolo', label: 'Codex (unrestricted)' }
    ],
    enableConfigKey: 'harnessCodexEnabled',
  });
}
