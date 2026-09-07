/** @param {import('@zana-ai/zcc-plugin-sdk').ZccPluginApi} zcc */
export default function plugin(zcc) {
  zcc.agents.experimental_registerPtyHarness({
    id: 'pi',
    displayName: 'Pi',
    icon: './icons/pi.svg',
    profiles: [
      { id: 'pi', label: 'Pi' },
      { id: 'pi-resume', label: 'Pi (resume)' }
    ],
    enableConfigKey: 'harnessPiEnabled',
  });
}
