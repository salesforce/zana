import type { HarnessRegistration } from '../registration.js';
import { PiProvider } from './provider.js';

const implementation = new PiProvider();

export const piHarness: HarnessRegistration = {
  id: 'pi',
  label: 'PI',
  profiles: [
    { id: 'pi', posture: 'default' },
    { id: 'pi-resume', posture: 'resume' }
  ],
  defaultProfileId: 'pi',
  implementation,
  renderRemoteCommand: (input) => implementation.buildRemoteCommand(input),
  supportedScopes: ['local', 'remote'],
  verification: {
    enabledConfigKey: 'harnessPiEnabled',
    installHint: 'npm i -g @earendil-works/pi-coding-agent',
    versionArgs: ['--version']
  }
};
