import type { HarnessRegistration } from '../registration.js';
import { ShellProvider } from './provider.js';

const implementation = new ShellProvider();

export const shellHarness: HarnessRegistration = {
  id: 'shell',
  label: 'Shell',
  profiles: [{ id: 'shell', posture: 'other' }],
  implementation,
  renderRemoteCommand: (input) => implementation.buildRemoteCommand(input),
  monitorCapability: { state: 'unsupported', sources: [], reason: 'Terminal-only profile' },
  supportedScopes: ['local', 'remote']
};
