import type { HarnessRegistration } from '../registration.js';
import { GrokProvider } from './provider.js';

const implementation = new GrokProvider();

export const grokHarness: HarnessRegistration = {
  id: 'grok',
  label: 'Grok Build',
  profiles: [
    { id: 'grok', posture: 'default' },
    { id: 'grok-resume', posture: 'resume' },
    { id: 'grok-yolo', posture: 'unrestricted' }
  ],
  defaultProfileId: 'grok',
  implementation,
  renderRemoteCommand: (input) => implementation.buildRemoteCommand(input),
  supportedScopes: ['local', 'remote'],
  verification: {
    enabledConfigKey: 'harnessGrokEnabled',
    installHint: 'https://docs.x.ai/docs/grok-build',
    versionArgs: ['--version']
  }
};
