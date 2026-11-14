import type { ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';

// Labels and dummy credentials mirror ../fixture-values.json (`secret`).
// Exercise both a stored secret and a separate descriptor-only default.
export default function plugin(zcc: ZccPluginApi) {
  zcc.settings.define({
    accessPhrase: {
      type: 'string',
      label: 'Fixture access phrase',
      description: 'Fixture-only secret. Its value must never be searchable.',
      secret: true
    },
    defaultAccessPhrase: {
      type: 'string',
      label: 'Fixture default access phrase',
      secret: true,
      default: 'fixture-default-credential-0000'
    },
    region: {
      type: 'string',
      label: 'Fixture region',
      description: 'Fixture-only non-secret companion setting.',
      default: 'ap-southeast-fixture'
    }
  });
}
