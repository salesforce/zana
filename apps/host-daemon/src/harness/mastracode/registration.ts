import type { HarnessRegistration } from '../registration.js';
import { MastracodeProvider } from './provider.js';
import { stripSessionResumeFlags } from '../argv-utils.js';

const implementation = new MastracodeProvider();

export const mastracodeHarness: HarnessRegistration = {
  id: 'mastracode',
  label: 'Mastra Code',
  profiles: [
    { id: 'mastracode', posture: 'default' },
    { id: 'mastracode-resume', posture: 'resume' },
    { id: 'mastracode-yolo', posture: 'unrestricted' }
  ],
  defaultProfileId: 'mastracode',
  implementation,
  renderRemoteCommand: (input) => implementation.buildRemoteCommand(input),
  restoreProjection: ({ extraArgs }) => ({
    profile: 'mastracode-resume',
    extraArgs: stripSessionResumeFlags(extraArgs)
  }),
  supportedScopes: ['local', 'remote'],
  verification: {
    enabledConfigKey: 'harnessMastracodeEnabled',
    installHint: 'https://code.mastra.ai/',
    versionArgs: ['--help']
  }
};
