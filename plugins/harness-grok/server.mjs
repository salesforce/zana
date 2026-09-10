/** @param {import('@zana-ai/zcc-plugin-sdk').ZccPluginApi} zcc */
export default function plugin(zcc) {
  zcc.agents.experimental_registerPtyHarness({
    id: 'grok',
    displayName: 'Grok Build',
    icon: './icons/grok.svg',
    profiles: [
      { id: 'grok', label: 'Grok Build' },
      { id: 'grok-resume', label: 'Grok Build (resume)' },
      { id: 'grok-yolo', label: 'Grok Build (unrestricted)' }
    ],
    enableConfigKey: 'harnessGrokEnabled',
  });
}
