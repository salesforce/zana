/** @param {import('@zana-ai/zcc-plugin-sdk').ZccPluginApi} zcc */
export default function plugin(zcc) {
  zcc.agents.experimental_registerPtyHarness({
    id: 'mastracode',
    displayName: 'Mastra Code',
    icon: './icons/mastracode.svg',
    profiles: [
      { id: 'mastracode', label: 'Mastra Code' },
      { id: 'mastracode-resume', label: 'Mastra Code (resume)' },
      { id: 'mastracode-yolo', label: 'Mastra Code (unrestricted)' }
    ],
    enableConfigKey: 'harnessMastracodeEnabled',
  });
}
