import { describe, it, expect, vi } from 'vitest';

type FsCap = {
  readFile(path: string, encoding?: 'utf-8'): Promise<string>;
  readdir(path: string): Promise<string[]>;
  writeFile(path: string, data: string): Promise<void>;
};

async function makeMainModule(fs: Partial<FsCap>) {
  const { default: defineMain } = await import('../main/index.js');
  const full: FsCap = {
    readFile: vi.fn(async () => { throw new Error('not found'); }),
    readdir: vi.fn(async () => []),
    writeFile: vi.fn(async () => {}),
    ...fs
  };
  const ctx = {
    fs: full,
    log: vi.fn(),
    storage: { get: vi.fn(async () => undefined), set: vi.fn() },
    host: {} as never
  };
  return { mod: defineMain.setup(ctx) as any, fs: full };
}

describe('getTeam', () => {
  it('returns the editable projection plus raw for a real file', async () => {
    const raw = {
      id: 'backend-squad', name: 'Backend Squad', icon: '⚙️',
      orchestratorProfileId: 'orchestrator',
      slots: [{ profileId: 'architect', quantity: 1 }],
      rules: { maxConcurrentWorkers: 4, autoRestart: true },
      autoStart: false, dynamicSpawning: true
    };
    const { mod } = await makeMainModule({
      readFile: vi.fn(async (p: string) => {
        if (p.endsWith('teams/backend-squad.json')) return JSON.stringify(raw);
        throw new Error('not found');
      })
    });
    const res = await mod.getTeam('backend-squad');
    expect(res.template.name).toBe('Backend Squad');
    expect(res.template.maxConcurrentWorkers).toBe(4);
    expect(res.template.slots).toEqual([{ profileId: 'architect', quantity: 1 }]);
    expect(res.raw.dynamicSpawning).toBe(true); // raw preserved for round-trip
  });

  it('returns null for a missing/malformed file', async () => {
    const { mod } = await makeMainModule({});
    expect(await mod.getTeam('nope')).toBeNull();
  });

  it('returns null and never reads for an unsafe id', async () => {
    const { mod, fs } = await makeMainModule({});
    expect(await mod.getTeam('../secrets')).toBeNull();
    expect(fs.readFile).not.toHaveBeenCalled();
  });
});

describe('listProfiles', () => {
  it('maps profile files to {id, displayName, icon}', async () => {
    const { mod } = await makeMainModule({
      readdir: vi.fn(async (p: string) => (p.endsWith('profiles') ? ['a.json', 'b.json'] : [])),
      readFile: vi.fn(async (p: string) => {
        if (p.endsWith('a.json')) return JSON.stringify({ id: 'architect', displayName: 'Architect', icon: '🏛️' });
        if (p.endsWith('b.json')) return JSON.stringify({ id: 'backend-dev', name: 'Backend Dev' });
        throw new Error('not found');
      })
    });
    const res = await mod.listProfiles();
    const byId = Object.fromEntries(res.map((p: any) => [p.id, p]));
    expect(byId['architect'].displayName).toBe('Architect');
    expect(byId['architect'].icon).toBe('🏛️');
    expect(byId['backend-dev'].displayName).toBe('Backend Dev'); // falls back to name
  });
});

describe('saveTeam', () => {
  it('creates a new team: slug filename, derived fields, ok:true', async () => {
    const writeFile = vi.fn(async () => {});
    const { mod } = await makeMainModule({
      readdir: vi.fn(async (p: string) => (p.endsWith('teams') ? ['existing.json'] : [])),
      writeFile
    });
    const res = await mod.saveTeam({
      name: 'Backend Squad',
      slots: [{ profileId: 'architect', quantity: 1 }, { profileId: 'backend-dev', quantity: 2 }],
      maxConcurrentWorkers: 4
    });
    expect(res).toEqual({ ok: true, id: 'backend-squad' });
    expect(writeFile).toHaveBeenCalledTimes(1);
    const calls = writeFile.mock.calls as unknown as [string, string][];
    const [path, data] = calls[0];
    expect(path).toMatch(/teams\/backend-squad\.json$/);
    const written = JSON.parse(data);
    expect(written.workerProfileIds).toEqual(['architect', 'backend-dev']);
    expect(written.maxTotalWorkers).toBe(3);
    expect(written.rules.maxConcurrentWorkers).toBe(4);
    expect(typeof written.updatedAt).toBe('string');
  });

  it('suffixes the slug on collision', async () => {
    const writeFile = vi.fn(async () => {});
    const { mod } = await makeMainModule({
      readdir: vi.fn(async (p: string) => (p.endsWith('teams') ? ['backend-squad.json'] : [])),
      writeFile
    });
    const res = await mod.saveTeam({ name: 'Backend Squad', slots: [{ profileId: 'a', quantity: 1 }] });
    expect(res).toEqual({ ok: true, id: 'backend-squad-2' });
  });

  it('edits an existing team in place, preserving id and unknown keys', async () => {
    const writeFile = vi.fn(async () => {});
    const raw = {
      id: 'backend-squad', name: 'Old', slots: [{ profileId: 'a', quantity: 1 }],
      rules: { maxConcurrentWorkers: 4, autoRestart: true }, dynamicSpawning: true
    };
    const { mod } = await makeMainModule({
      readFile: vi.fn(async (p: string) =>
        p.endsWith('teams/backend-squad.json') ? JSON.stringify(raw) : (() => { throw new Error('x'); })()
      ),
      readdir: vi.fn(async (p: string) => (p.endsWith('teams') ? ['backend-squad.json'] : [])),
      writeFile
    });
    const res = await mod.saveTeam({
      id: 'backend-squad', name: 'New Name', slots: [{ profileId: 'a', quantity: 3 }]
    });
    expect(res).toEqual({ ok: true, id: 'backend-squad' });
    expect(writeFile).toHaveBeenCalledTimes(1);
    const calls = writeFile.mock.calls as unknown as [string, string][];
    const written = JSON.parse(calls[0][1]);
    expect(written.name).toBe('New Name');
    expect(written.dynamicSpawning).toBe(true); // preserved
    expect(written.rules.autoRestart).toBe(true); // preserved
    expect(written.maxTotalWorkers).toBe(3);
  });

  it('returns ok:false on validation failure and never writes', async () => {
    const writeFile = vi.fn(async () => {});
    const { mod } = await makeMainModule({ writeFile });
    const res = await mod.saveTeam({ name: '', slots: [] });
    expect(res.ok).toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('returns ok:false (not a throw) when writeFile is denied', async () => {
    const { mod } = await makeMainModule({
      readdir: vi.fn(async () => []),
      writeFile: vi.fn(async () => { throw new Error('PermissionDenied: fs:write'); })
    });
    const res = await mod.saveTeam({ name: 'X', slots: [{ profileId: 'a', quantity: 1 }] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/permission|write/i);
  });
});
