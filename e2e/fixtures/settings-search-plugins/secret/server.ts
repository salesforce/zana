import type { ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';

// Labels mirror ../fixture-values.json (`secret`). The E2E seeds `secretValue`
// through the settings API; it is deliberately NOT a default here.
export default function plugin(zcc: ZccPluginApi) {
  zcc.settings.define({
    accessPhrase: {
      type: 'string',
      label: 'Fixture access phrase',
      description: 'Fixture-only secret. Its value must never be searchable.',
      secret: true
    },
    region: {
      type: 'string',
      label: 'Fixture region',
      description: 'Fixture-only non-secret companion setting.',
      default: 'ap-southeast-fixture'
    }
  });
}
