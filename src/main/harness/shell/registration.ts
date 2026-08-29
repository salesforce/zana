import type { HarnessRegistration } from '../registration.js';
import { ShellProvider } from './provider.js';

const implementation = new ShellProvider();

export const shellHarness: HarnessRegistration = {
  id: 'shell',
  label: 'Shell',
  profiles: [{ id: 'shell', posture: 'other' }],
  implementation,
  renderRemoteCommand: (input) => implementation.buildRemoteCommand(input),
  supportedScopes: ['local', 'remote']
};
