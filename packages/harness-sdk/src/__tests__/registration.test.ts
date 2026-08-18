import { describe, expect, it } from 'vitest';
import { validateHarnessRegistrations } from '../registration.js';

describe('validateHarnessRegistrations', () => {
  it('accepts independently-owned profiles', () => {
    expect(validateHarnessRegistrations([
      {
        id: 'alpha', label: 'Alpha', profiles: [{ id: 'alpha', posture: 'default' }],
        defaultProfileId: 'alpha', implementation: {}, supportedScopes: ['local']
      },
      {
        id: 'beta', label: 'Beta', profiles: [{ id: 'beta', posture: 'default' }],
        defaultProfileId: 'beta', implementation: {}, supportedScopes: ['local', 'remote']
      }
    ])).toEqual([]);
  });

  it('rejects duplicate harness ids, profiles, and invalid defaults', () => {
    const issues = validateHarnessRegistrations([
      {
        id: 'alpha', label: 'Alpha', profiles: [{ id: 'shared', posture: 'default' }],
        defaultProfileId: 'missing', implementation: {}, supportedScopes: ['local']
      },
      {
        id: 'alpha', label: 'Other Alpha', profiles: [{ id: 'shared', posture: 'default' }],
        implementation: {}, supportedScopes: ['local']
      }
    ]);

    expect(issues.map((issue) => issue.message)).toEqual([
      'alpha default profile is not registered: missing.',
      'Duplicate harness registration id: alpha.',
      'Profile shared is registered by both alpha and alpha.'
    ]);
  });

  it('rejects empty labels and invalid scope declarations', () => {
    const issues = validateHarnessRegistrations([{
      id: 'alpha', label: ' ', profiles: [{ id: 'alpha', posture: 'default' }],
      implementation: {}, supportedScopes: []
    }]);
    expect(issues.map((issue) => issue.message)).toEqual([
      'alpha label must not be empty.',
      'alpha must support at least one scope.'
    ]);
  });
});
