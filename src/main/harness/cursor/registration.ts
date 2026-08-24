import type { HarnessRegistration } from '../registration.js';
import { CursorProvider } from './provider.js';

const implementation = new CursorProvider();

export const cursorHarness: HarnessRegistration = {
  id: 'cursor',
  label: 'Cursor',
  profiles: [
    { id: 'cursor', posture: 'default' },
    { id: 'cursor-resume', posture: 'resume' },
    { id: 'cursor-yolo', posture: 'unrestricted' }
  ],
  defaultProfileId: 'cursor',
  implementation,
  renderRemoteCommand: (input) => implementation.buildRemoteCommand(input),
  monitorCapability: { state: 'unsupported', sources: [], reason: 'No verified native monitor source' },
  supportedScopes: ['local', 'remote'],
  verification: {
    enabledConfigKey: 'harnessCursorEnabled',
    installHint: 'https://cursor.com/cli',
    versionArgs: ['--version']
  }
};
