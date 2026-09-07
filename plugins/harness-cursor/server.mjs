/** @param {import('@zana-ai/zcc-plugin-sdk').ZccPluginApi} zcc */
export default function plugin(zcc) {
  zcc.agents.experimental_registerPtyHarness({
    id: 'cursor',
    displayName: 'Cursor',
    icon: './icons/cursor.svg',
    profiles: [
      { id: 'cursor', label: 'Cursor' },
      { id: 'cursor-resume', label: 'Cursor (resume)' },
      { id: 'cursor-yolo', label: 'Cursor (unrestricted)' }
    ],
    enableConfigKey: 'harnessCursorEnabled',
  });
}
