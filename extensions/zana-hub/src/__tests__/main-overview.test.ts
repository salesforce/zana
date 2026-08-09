/**
 * Zana Hub main-process overview() — unit tests verifying bounded reads,
 * error resilience, and the cross-project aggregation contract.
 */
import { describe, it, expect, vi } from 'vitest';

type FsCap = {
  readFile(path: string, encoding?: 'utf-8'): Promise<string>;
  readdir(path: string): Promise<string[]>;
  writeFile(path: string, data: string): Promise<void>;
};

type MainModule = {
  overview(): Promise<{
    present: boolean;
    teams: unknown[];
    profiles: unknown[];
    skills: unknown[];
    sprints: unknown[];
    runs: unknown[];
    runStateCounts: Record<string, number>;
    workerCount: number;
    autopilotGoalCount: number;
    warnings: string[];
  }>;
  detail(
    kind: 'team' | 'profile' | 'skill' | 'run',
    id: string
  ): Promise<{ kind: string; id: string; title: string; icon?: string; fields: Array<{ label: string; value: string; block?: boolean }> } | null>;
};

/**
 * Create a fake main module instance by calling the defineMainModule setup.
 * We mock ctx.fs and capture the returned methods.
 */
async function makeMainModule(fs: FsCap): Promise<MainModule> {
  // Dynamic import to avoid hoisting issues with mocked modules
  const { default: defineMain } = await import('../main/index.js');
  const ctx = {
    fs,
    log: vi.fn(),
    // `storage` is required on MainModuleContext; a stub is enough here since
    // overview()/detail()/save*() only touch ctx.fs + ctx.log.
    storage: { get: vi.fn(async () => undefined), set: vi.fn(async () => {}) },
    host: {} as never
  };
  // setup() may be sync or async; await handles both. Cast through the generic
  // capability bag the SDK types it as, into our narrowed MainModule.
  return (await defineMain.setup(ctx as never)) as unknown as MainModule;
}

function mockFs(overrides: Partial<FsCap> = {}): FsCap {
  return {
    readFile: vi.fn(async () => {
      throw new Error('not found');
    }),
    readdir: vi.fn(async () => []),
    writeFile: vi.fn(async () => {}),
    ...overrides
  };
}

describe('zana-hub overview()', () => {
  it('returns present:false when ~/.zana does not exist', async () => {
    const fs = mockFs({
      readdir: vi.fn(async () => {
        throw new Error('ENOENT');
      })
    });
    const main = await makeMainModule(fs);
    const res = await main.overview();
    expect(res.present).toBe(false);
    expect(res.teams).toEqual([]);
    expect(res.warnings).toEqual([]);
  });

  it('reads teams/profiles/skills dirs bounded at 200 files per dir', async () => {
    const fs = mockFs({
      readdir: vi.fn(async (path: string) => {
        if (path.includes('.zana')) return ['teams', 'profiles', 'skills'];
        // Simulate 250 files, verify only 200 are read
        if (path.includes('teams')) return Array.from({ length: 250 }, (_, i) => `t${i}.json`);
        return [];
      }),
      readFile: vi.fn(async (path: string) => {
        if (path.includes('teams/t')) {
          const match = path.match(/t(\d+)\.json/);
          const idx = match ? parseInt(match[1]) : 0;
          return JSON.stringify({ id: `team-${idx}`, name: `Team ${idx}` });
        }
        if (path.includes('workers.json')) return '[]';
        if (path.includes('automation-state.json')) return '{}';
        throw new Error('not found');
      })
    });

    const main = await makeMainModule(fs);
    const res = await main.overview();

    expect(res.present).toBe(true);
    // Should cap at 200, not read all 250
    expect(res.teams.length).toBeLessThanOrEqual(200);
    // Verify readFile was called max 200 times for teams dir
    const teamFileCalls = (fs.readFile as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call) => call[0].includes('teams/t')
    );
    expect(teamFileCalls.length).toBeLessThanOrEqual(200);
  });

  it('skips corrupt JSON files silently and records warnings on read errors', async () => {
    const fs = mockFs({
      readdir: vi.fn(async (path: string) => {
        if (path.endsWith('.zana')) return ['teams'];
        if (path.endsWith('teams')) return ['good.json', 'bad.json', 'unreadable.json'];
        return [];
      }),
      readFile: vi.fn(async (path: string) => {
        if (path.endsWith('good.json')) return JSON.stringify({ id: 't1', name: 'Good' });
        // Malformed JSON is silently skipped (safeParse returns undefined)
        if (path.endsWith('bad.json')) return '{ invalid json';
        // Read error generates a warning
        if (path.endsWith('unreadable.json')) throw new Error('EACCES: permission denied');
        if (path.endsWith('workers.json')) return '[]';
        if (path.endsWith('automation-state.json')) return '{}';
        throw new Error('not found');
      })
    });

    const main = await makeMainModule(fs);
    const res = await main.overview();

    expect(res.present).toBe(true);
    // Only the good file should be parsed
    expect(res.teams).toHaveLength(1);
    expect((res.teams[0] as { name?: string }).name).toBe('Good');
    // The unreadable file should generate a warning
    expect(res.warnings.length).toBeGreaterThan(0);
    expect(res.warnings.some(w => w.includes('unreadable.json'))).toBe(true);
  });

  it('tallies run states and returns newest 40 runs', async () => {
    const fs = mockFs({
      readdir: vi.fn(async (path: string) => {
        if (path.endsWith('.zana')) return ['runs'];
        if (path.endsWith('runs')) return Array.from({ length: 60 }, (_, i) => `r${i}.json`);
        return [];
      }),
      readFile: vi.fn(async (path: string) => {
        if (path.includes('/runs/r')) {
          const match = path.match(/r(\d+)\.json/);
          const idx = match ? parseInt(match[1]) : 0;
          return JSON.stringify({
            id: `run-${idx}`,
            state: idx < 30 ? 'completed' : 'running',
            spawnedAt: 1000000 + idx
          });
        }
        if (path.endsWith('workers.json')) return '[]';
        if (path.endsWith('automation-state.json')) return '{}';
        throw new Error('not found');
      })
    });

    const main = await makeMainModule(fs);
    const res = await main.overview();

    expect(res.present).toBe(true);
    // Should return only 40 newest runs
    expect(res.runs.length).toBe(40);
    // But state counts should include all 60
    expect(res.runStateCounts['completed']).toBe(30);
    expect(res.runStateCounts['running']).toBe(30);
  });

  it('returns no-fs-capability warning when ctx.fs is missing', async () => {
    // Create module with no fs capability
    const { default: defineMain } = await import('../main/index.js');
    const ctx = {
      fs: undefined,
      log: vi.fn(),
      storage: { get: vi.fn(async () => undefined), set: vi.fn(async () => {}) },
      host: {} as never
    };
    const main = (await defineMain.setup(ctx as never)) as unknown as MainModule;

    const res = await main.overview();
    expect(res.present).toBe(false);
    expect(res.warnings).toEqual(['filesystem capability unavailable — grant fs:read for ~/.zana']);
  });

  it('resolves profile name from displayName (Zana schema), not the id', async () => {
    const fs = mockFs({
      readdir: vi.fn(async (path: string) => {
        if (path.endsWith('.zana')) return ['profiles'];
        if (path.endsWith('profiles')) return ['p1.json', 'p2.json'];
        return [];
      }),
      readFile: vi.fn(async (path: string) => {
        if (path.endsWith('p1.json'))
          return JSON.stringify({
            id: 'slack-reporter',
            displayName: 'Slack Reporter',
            category: 'ops',
            model: 'claude-haiku-4-5-20251001',
            description: 'Posts run summaries to Slack.'
          });
        // Legacy record with only `name` still resolves.
        if (path.endsWith('p2.json')) return JSON.stringify({ id: 'legacy', name: 'Legacy One' });
        throw new Error('not found');
      })
    });

    const main = await makeMainModule(fs);
    const res = await main.overview();

    const byId = Object.fromEntries(
      (res.profiles as Array<{ id: string; name: string; category?: string; description?: string }>).map((p) => [p.id, p])
    );
    expect(byId['slack-reporter'].name).toBe('Slack Reporter');
    expect(byId['slack-reporter'].category).toBe('ops');
    expect(byId['slack-reporter'].description).toBe('Posts run summaries to Slack.');
    expect(byId['legacy'].name).toBe('Legacy One');
  });

  it('sums slot quantities into workerTotal and builds a roster preview', async () => {
    const fs = mockFs({
      readdir: vi.fn(async (path: string) => {
        if (path.endsWith('.zana')) return ['teams'];
        if (path.endsWith('teams')) return ['squad.json'];
        return [];
      }),
      readFile: vi.fn(async (path: string) => {
        if (path.endsWith('squad.json'))
          return JSON.stringify({
            id: 'backend-squad',
            name: 'Backend Squad',
            description: 'Logic-focused team.',
            slots: [
              { profileId: 'architect', quantity: 1 },
              { profileId: 'backend-dev', quantity: 2 },
              { profileId: 'test-writer', quantity: 1 }
            ],
            rules: { maxConcurrentWorkers: 4 }
          });
        throw new Error('not found');
      })
    });

    const main = await makeMainModule(fs);
    const res = await main.overview();

    const t = res.teams[0] as {
      slots: number;
      workerTotal: number;
      roster?: string;
      maxWorkers?: number;
      description?: string;
    };
    expect(t.slots).toBe(3);
    expect(t.workerTotal).toBe(4);
    expect(t.roster).toBe('architect · backend-dev×2 · test-writer');
    expect(t.maxWorkers).toBe(4);
    expect(t.description).toBe('Logic-focused team.');
  });

  it('counts workers and autopilot goals from singleton files', async () => {
    const fs = mockFs({
      readdir: vi.fn(async (path: string) => {
        if (path.includes('.zana')) return [];
        return [];
      }),
      readFile: vi.fn(async (path: string) => {
        if (path.includes('workers.json')) return JSON.stringify([{ id: 'w1' }, { id: 'w2' }]);
        if (path.includes('automation-state.json')) {
          return JSON.stringify({ goals: { g1: {}, g2: {}, g3: {} } });
        }
        throw new Error('not found');
      })
    });

    const main = await makeMainModule(fs);
    const res = await main.overview();

    expect(res.workerCount).toBe(2);
    expect(res.autopilotGoalCount).toBe(3);
  });
});

describe('zana-hub detail()', () => {
  it('curates a skill record into ordered fields incl. its content block', async () => {
    const fs = mockFs({
      readFile: vi.fn(async (path: string) => {
        if (path.endsWith('skills/s1.json'))
          return JSON.stringify({
            id: 's1',
            name: 'stringutils-conventions',
            type: 'instruction',
            enabled: true,
            global: true,
            description: 'Project conventions',
            content: 'Pure functions only.'
          });
        throw new Error('not found');
      })
    });

    const main = await makeMainModule(fs);
    const detail = await main.detail('skill', 's1');

    expect(detail).not.toBeNull();
    expect(detail!.kind).toBe('skill');
    expect(detail!.title).toBe('stringutils-conventions');
    const byLabel = Object.fromEntries(detail!.fields.map((f) => [f.label, f]));
    expect(byLabel['Type'].value).toBe('instruction');
    expect(byLabel['Enabled'].value).toBe('yes');
    expect(byLabel['Scope'].value).toBe('global');
    expect(byLabel['Content'].value).toBe('Pure functions only.');
    expect(byLabel['Content'].block).toBe(true);
  });

  it('surfaces a team initial prompt and roster with slot quantities', async () => {
    const fs = mockFs({
      readFile: vi.fn(async (path: string) => {
        if (path.endsWith('teams/squad.json'))
          return JSON.stringify({
            id: 'squad',
            name: 'Backend Squad',
            orchestratorProfileId: 'orchestrator',
            slots: [
              { profileId: 'architect', quantity: 1 },
              { profileId: 'backend-dev', quantity: 2 }
            ],
            rules: { maxConcurrentWorkers: 4, autoRestart: false },
            initialPrompt: 'Plan the backend.'
          });
        throw new Error('not found');
      })
    });

    const main = await makeMainModule(fs);
    const detail = await main.detail('team', 'squad');

    const byLabel = Object.fromEntries(detail!.fields.map((f) => [f.label, f]));
    expect(byLabel['Roster'].value).toBe('architect, backend-dev ×2');
    expect(byLabel['Orchestrator'].value).toBe('orchestrator');
    expect(byLabel['Rules'].value).toContain('max 4 concurrent');
    expect(byLabel['Initial prompt'].value).toBe('Plan the backend.');
    expect(byLabel['Initial prompt'].block).toBe(true);
  });

  it('returns null for a missing record and rejects a traversal id', async () => {
    const main = await makeMainModule(mockFs());
    expect(await main.detail('profile', 'nope')).toBeNull();
    // A crafted id with separators must never escape the fs-gated root.
    expect(await main.detail('skill', '../../etc/passwd')).toBeNull();
  });
});
