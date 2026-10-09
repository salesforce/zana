import type { ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';

// Values mirror ../fixture-values.json (`normal`); keep them in step.
export default function plugin(zcc: ZccPluginApi) {
  zcc.settings.define({
    relayEndpoint: {
      type: 'string',
      label: 'Relay endpoint',
      description: 'Fixture-only quokka gateway address used by the settings search spec.',
      default: 'https://relay.fixture.test/quokka'
    },
    deliveryStrategy: {
      type: 'select',
      label: 'Delivery strategy',
      description: 'How the fixture pretends to deliver messages.',
      options: ['fast', 'balanced', 'thorough'],
      default: 'balanced'
    },
    retryBudget: {
      type: 'number',
      label: 'Retry budget',
      description: 'Fixture-only retry count.',
      default: 3,
      min: 0,
      max: 20
    },
    emitTraces: {
      type: 'boolean',
      label: 'Emit wombat traces',
      description: 'Fixture-only toggle with no effect.',
      default: false
    }
  });
}
