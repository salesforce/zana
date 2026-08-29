import { describe, expect, it } from 'vitest';
import { listOpenCodeSessions } from './opencode-sessions.js';

const cwd = '/Users/me/project';

describe('listOpenCodeSessions', () => {
  it('projects valid CLI rows for the requested directory', async () => {
    const sessions = await listOpenCodeSessions(cwd, {
      run: async () => [
        { id: 'ses_abc', title: 'Fix login', created: 100, updated: 200, directory: cwd },
        { id: 'ses_other', title: 'Other', created: 1, updated: 2, directory: '/Users/me/other' }
      ]
    });

    expect(sessions).toEqual([{ id: 'ses_abc', title: 'Fix login', startedAt: 100, lastActiveAt: 200 }]);
  });

  it('returns an empty list when the CLI fails or returns malformed data', async () => {
    expect(await listOpenCodeSessions(cwd, { run: async () => null })).toEqual([]);
    expect(
      await listOpenCodeSessions(cwd, {
        run: async () => [{ id: 'ses_abc', title: 1, created: 100, updated: 200, directory: cwd }]
      })
    ).toEqual([]);
  });

  it('caps provider-native list requests to caller demand', async () => {
    let requestedLimit = 0;
    await listOpenCodeSessions(cwd, {
      limit: 8,
      run: async (_cwd, limit) => {
        requestedLimit = limit;
        return [];
      }
    });
    expect(requestedLimit).toBe(8);
  });
});
