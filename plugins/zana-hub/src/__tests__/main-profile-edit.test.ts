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
  return { mod: defineMain.setup(ctx as never) as any, fs: full };
}

describe('getProfile', () => {
  it('returns the editable projection plus raw for a real file', async () => {
    const raw = {
      id: 'abc123', displayName: 'Core Architect', icon: '📐',
      description: 'Plans the work', category: 'engineering',
      model: 'claude-opus-4-8', effortLevel: 'high', permissionMode: 'default',
      systemPrompt: 'You design.', allowedTools: ['Read', 'Grep'], disallowedTools: ['Write'],
      createdAt: '2020-01-01T00:00:00.000Z', builtIn: false, someFutureKey: 'keep'
    };
    const { mod } = await makeMainModule({
      readFile: vi.fn(async (p: string) => {
        if (p.endsWith('profiles/abc123.json')) return JSON.stringify(raw);
        throw new Error('not found');
      })
    });
    const res = await mod.getProfile('abc123');
    expect(res.template.displayName).toBe('Core Architect');
    expect(res.template.model).toBe('claude-opus-4-8');
    expect(res.template.allowedTools).toEqual(['Read', 'Grep']);
    expect(res.template.disallowedTools).toEqual(['Write']);
    expect(res.raw.someFutureKey).toBe('keep'); // raw preserved for round-trip
  });

  it('falls back displayName to name, then id; missing tool lists → []', async () => {
    const { mod } = await makeMainModule({
      readFile: vi.fn(async (p: string) =>
        p.endsWith('profiles/p1.json')
          ? JSON.stringify({ id: 'p1', name: 'Legacy Name' })
          : (() => { throw new Error('x'); })()
      )
    });
    const res = await mod.getProfile('p1');
    expect(res.template.displayName).toBe('Legacy Name');
    expect(res.template.allowedTools).toEqual([]);
    expect(res.template.disallowedTools).toEqual([]);
  });

  it('returns null for a missing/malformed file', async () => {
    const { mod } = await makeMainModule({});
    expect(await mod.getProfile('nope')).toBeNull();
  });

  it('returns null and never reads for an unsafe id', async () => {
    const { mod, fs } = await makeMainModule({});
    expect(await mod.getProfile('../secrets')).toBeNull();
    expect(fs.readFile).not.toHaveBeenCalled();
  });
});

describe('saveProfile', () => {
  it('creates a new profile: minted UUID filename, ok:true', async () => {
    const writeFile = vi.fn(async () => {});
    const { mod } = await makeMainModule({ writeFile });
    const res = await mod.saveProfile({
      displayName: 'New Reviewer', allowedTools: ['Read'], disallowedTools: []
    });
    expect(res.ok).toBe(true);
    expect(writeFile).toHaveBeenCalledTimes(1);
    const calls = writeFile.mock.calls as unknown as [string, string][];
    const [path, data] = calls[0];
    // UUID stem, written under profiles/
    expect(path).toMatch(/profiles\/[0-9a-f-]{36}\.json$/i);
    const written = JSON.parse(data);
    expect(written.displayName).toBe('New Reviewer');
    expect(written.id).toBe(res.id);
    expect(typeof written.createdAt).toBe('string');
    expect(typeof written.updatedAt).toBe('string');
  });

  it('edits an existing profile in place, preserving id and unknown keys', async () => {
    const writeFile = vi.fn(async () => {});
    const raw = {
      id: 'abc123', displayName: 'Old', allowedTools: ['Read'], disallowedTools: [],
      createdAt: '2020-01-01T00:00:00.000Z', builtIn: false, someFutureKey: 'keep'
    };
    const { mod } = await makeMainModule({
      readFile: vi.fn(async (p: string) =>
        p.endsWith('profiles/abc123.json') ? JSON.stringify(raw) : (() => { throw new Error('x'); })()
      ),
      writeFile
    });
    const res = await mod.saveProfile({
      id: 'abc123', displayName: 'New Name', model: 'claude-opus-4-8',
      allowedTools: ['Read', 'Grep'], disallowedTools: ['Write']
    });
    expect(res).toEqual({ ok: true, id: 'abc123' });
    const calls = writeFile.mock.calls as unknown as [string, string][];
    const written = JSON.parse(calls[0][1]);
    expect(written.displayName).toBe('New Name');
    expect(written.model).toBe('claude-opus-4-8');
    expect(written.allowedTools).toEqual(['Read', 'Grep']);
    expect(written.someFutureKey).toBe('keep'); // preserved
    expect(written.createdAt).toBe('2020-01-01T00:00:00.000Z'); // preserved
  });

  it('returns ok:false on validation failure and never writes', async () => {
    const writeFile = vi.fn(async () => {});
    const { mod } = await makeMainModule({ writeFile });
    const res = await mod.saveProfile({ displayName: '', allowedTools: [], disallowedTools: [] });
    expect(res.ok).toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('returns ok:false (not a throw) when writeFile is denied', async () => {
    const { mod } = await makeMainModule({
      writeFile: vi.fn(async () => { throw new Error('PermissionDenied: fs:write'); })
    });
    const res = await mod.saveProfile({ displayName: 'X', allowedTools: [], disallowedTools: [] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/permission|write/i);
  });
});
