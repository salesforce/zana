/**
 * Golden-file-style tests for runCli. Creates a temp fixture data dir with
 * sample projects, schedules, personas, and inbox entries, then asserts
 * various command outputs.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCli } from '../lib/run-cli.js';

const fixtureDir = join(tmpdir(), `cc-cli-test-${Date.now()}`);

function projectsFetch(projects: unknown[]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.pathname === '/api/v1/projects') {
      return new Response(JSON.stringify({ projects }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    return new Response(JSON.stringify({ error: 'unmocked' }), { status: 404 });
  }) as typeof fetch;
}

const fixtureProjects = [
  { id: 'proj-001', name: 'Test Project', path: '/home/user/test-project', tag: 'test' },
  { id: 'proj-002', name: 'Another Project', path: '/home/user/another' }
];

beforeAll(() => {
  // Create fixture data directory
  mkdirSync(fixtureDir, { recursive: true });
  mkdirSync(join(fixtureDir, 'schedules'), { recursive: true });
  mkdirSync(join(fixtureDir, 'personas'), { recursive: true });
  mkdirSync(join(fixtureDir, 'inbox'), { recursive: true });
  mkdirSync(join(fixtureDir, 'followups'), { recursive: true });

  // projects.json (v1 format)
  writeFileSync(
    join(fixtureDir, 'projects.json'),
    JSON.stringify({
      version: 1,
      projects: [
        {
          id: 'proj-001',
          name: 'Test Project',
          path: '/home/user/test-project',
          tag: 'test',
          createdAt: 1000000000,
          lastActiveAt: 1000000100
        },
        {
          id: 'proj-002',
          name: 'Another Project',
          path: '/home/user/another',
          createdAt: 1000000000,
          lastActiveAt: 1000000100
        }
      ]
    }, null, 2)
  );

  // schedules/schedule1.json
  writeFileSync(
    join(fixtureDir, 'schedules', 'schedule1.json'),
    JSON.stringify({
      id: 'sched-001',
      name: 'Daily Review',
      enabled: true,
      projectId: 'proj-001',
      profile: 'claude',
      schedule: { every: '24h' },
      overlap: 'skip',
      history: { retain: 10 },
      status: {
        runCount: 5,
        runs: [],
        lastRunResult: 'success'
      },
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z'
    }, null, 2)
  );

  // personas/my-persona.json
  writeFileSync(
    join(fixtureDir, 'personas', 'my-persona.json'),
    JSON.stringify({
      id: 'custom-reviewer',
      name: 'Custom Reviewer',
      baseProfile: 'claude',
      model: 'opus',
      description: 'A custom code reviewer'
    }, null, 2)
  );

  // inbox/entries.jsonl
  const entries = [
    {
      id: 'inbox-001',
      ts: 1000000000,
      projectId: 'proj-001',
      projectLabel: 'Test Project',
      comments: 'First entry\nWith multiple lines',
      docs: [{ path: 'src/file.ts' }]
    },
    {
      id: 'inbox-002',
      ts: 1000000100,
      projectId: 'proj-002',
      comments: 'Second entry',
      docs: []
    }
  ];
  writeFileSync(
    join(fixtureDir, 'inbox', 'entries.jsonl'),
    entries.map(e => JSON.stringify(e)).join('\n')
  );

  // followups/*.json — one open (idle-triage) + one resolved (agent).
  writeFileSync(
    join(fixtureDir, 'followups', 'fu-open.json'),
    JSON.stringify({
      id: 'fu-open-0001',
      projectId: 'proj-001',
      title: 'Should I push 0.8.7 and merge to main?',
      kind: 'question',
      status: 'open',
      origin: { source: 'idle-triage', sessionId: 's1' },
      createdAt: '2026-07-01T20:00:00Z',
      updatedAt: '2026-07-01T20:00:00Z'
    }, null, 2)
  );
  writeFileSync(
    join(fixtureDir, 'followups', 'fu-resolved.json'),
    JSON.stringify({
      id: 'fu-res-0002',
      projectId: 'proj-002',
      title: 'Commit on branch or branch off?',
      kind: 'decision',
      status: 'resolved',
      origin: { source: 'agent', sessionId: 's2' },
      resolution: 'branched off',
      createdAt: '2026-06-30T20:00:00Z',
      updatedAt: '2026-06-30T21:00:00Z',
      resolvedAt: '2026-06-30T21:00:00Z'
    }, null, 2)
  );

  // Malformed files for error handling tests
  writeFileSync(
    join(fixtureDir, 'schedules', 'bad.json'),
    '{ "id": "bad", "name": "missing required fields" }'
  );
  writeFileSync(
    join(fixtureDir, 'personas', 'bad.json'),
    '{ "id": null }'
  );
});

afterAll(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

describe('cc CLI', () => {
  it('shows help with --help', async () => {
    const result = await runCli(['node', 'zcc', '--help'], { dataDir: fixtureDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('USAGE:');
    expect(result.stdout).toContain('zcc <command>');
  });

  it('shows version with --version', async () => {
    const result = await runCli(['node', 'zcc', '--version'], { dataDir: fixtureDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/zcc version \d+\.\d+\.\d+/);
  });

  it('lists projects as JSON', async () => {
    const result = await runCli(['node', 'zcc', 'projects', 'ls', '--json'], {
      dataDir: fixtureDir,
      fetchImpl: projectsFetch(fixtureProjects)
    });
    expect(result.exitCode).toBe(0);
    const projects = JSON.parse(result.stdout);
    expect(projects).toHaveLength(2);
    expect(projects[0].name).toBe('Test Project');
    expect(projects[1].name).toBe('Another Project');
  });

  it('lists projects as human table', async () => {
    const result = await runCli(['node', 'zcc', 'projects', 'ls'], {
      dataDir: fixtureDir,
      fetchImpl: projectsFetch(fixtureProjects)
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('proj-001');
    expect(result.stdout).toContain('Test Project');
    expect(result.stdout).toContain('Another Project');
  });

  it('lists personas as JSON', async () => {
    const result = await runCli(['node', 'zcc', 'personas', 'ls', '--json'], { dataDir: fixtureDir });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('personas/bad.json');
    const personas = JSON.parse(result.stdout);
    expect(personas).toHaveLength(1);
    expect(personas[0].id).toBe('custom-reviewer');
    expect(personas[0].name).toBe('Custom Reviewer');
  });

  it('lists personas as human table', async () => {
    const result = await runCli(['node', 'zcc', 'personas', 'ls'], { dataDir: fixtureDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('ID');
    expect(result.stdout).toContain('NAME');
    expect(result.stdout).toContain('custom-reviewer');
    expect(result.stdout).toContain('Custom Reviewer');
  });

  it('lists schedules as JSON', async () => {
    const result = await runCli(['node', 'zcc', 'schedule', 'ls', '--json'], { dataDir: fixtureDir });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('schedules/bad.json');
    const schedules = JSON.parse(result.stdout);
    expect(schedules).toHaveLength(1);
    expect(schedules[0].id).toBe('sched-001');
    expect(schedules[0].name).toBe('Daily Review');
  });

  it('lists schedules as human table', async () => {
    const result = await runCli(['node', 'zcc', 'schedule', 'ls'], { dataDir: fixtureDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('ID');
    expect(result.stdout).toContain('NAME');
    expect(result.stdout).toContain('Daily Review');
    expect(result.stdout).toContain('success');
  });

  it('lists inbox entries as JSON', async () => {
    const result = await runCli(['node', 'zcc', 'inbox', 'ls', '--json'], { dataDir: fixtureDir });
    expect(result.exitCode).toBe(0);
    const entries = JSON.parse(result.stdout);
    expect(entries).toHaveLength(2);
    expect(entries[0].id).toBe('inbox-002'); // Newest first
    expect(entries[1].id).toBe('inbox-001');
  });

  it('lists inbox entries as human table', async () => {
    const result = await runCli(['node', 'zcc', 'inbox', 'ls'], { dataDir: fixtureDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('ID');
    expect(result.stdout).toContain('TIMESTAMP');
    expect(result.stdout).toContain('First entry');
    expect(result.stdout).toContain('Second entry');
  });

  it('filters inbox by project', async () => {
    const result = await runCli(['node', 'zcc', 'inbox', 'ls', '--project', 'proj-001', '--json'], { dataDir: fixtureDir });
    expect(result.exitCode).toBe(0);
    const entries = JSON.parse(result.stdout);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('inbox-001');
  });

  it('shows full inbox entry', async () => {
    const result = await runCli(['node', 'zcc', 'inbox', 'show', 'inbox-001'], { dataDir: fixtureDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Inbox Entry: inbox-001');
    expect(result.stdout).toContain('Test Project');
    expect(result.stdout).toContain('First entry');
    expect(result.stdout).toContain('src/file.ts');
  });

  it('shows full inbox entry as JSON', async () => {
    const result = await runCli(['node', 'zcc', 'inbox', 'show', 'inbox-001', '--json'], { dataDir: fixtureDir });
    expect(result.exitCode).toBe(0);
    const entry = JSON.parse(result.stdout);
    expect(entry.id).toBe('inbox-001');
    expect(entry.comments).toContain('First entry');
  });

  it('handles missing inbox entry', async () => {
    const result = await runCli(['node', 'zcc', 'inbox', 'show', 'nonexistent'], { dataDir: fixtureDir });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('not found');
  });

  it('inbox show with no id is a usage error (exit 2)', async () => {
    const result = await runCli(['node', 'zcc', 'inbox', 'show'], { dataDir: fixtureDir });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('requires an entry id');
  });

  it('lists open follow-ups by default (human table)', async () => {
    const result = await runCli(['node', 'zcc', 'followup', 'ls'], { dataDir: fixtureDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Should I push 0.8.7');
    // The resolved one is hidden unless --all / --status is passed.
    expect(result.stdout).not.toContain('Commit on branch');
    expect(result.stdout).toContain('STATUS');
  });

  it('lists all follow-ups with --all', async () => {
    const result = await runCli(['node', 'zcc', 'followup', 'ls', '--all'], { dataDir: fixtureDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Should I push 0.8.7');
    expect(result.stdout).toContain('Commit on branch');
  });

  it('filters follow-ups by --status', async () => {
    const result = await runCli(['node', 'zcc', 'followup', 'ls', '--status', 'resolved', '--json'], { dataDir: fixtureDir });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('fu-res-0002');
  });

  it('filters follow-ups by project tag', async () => {
    const result = await runCli(['node', 'zcc', 'followup', 'ls', '--project', 'test', '--all', '--json'], { dataDir: fixtureDir });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    // 'test' tag → proj-001 → only the open one.
    expect(parsed).toHaveLength(1);
    expect(parsed[0].projectId).toBe('proj-001');
  });

  it('rejects an invalid --status (exit 2)', async () => {
    const result = await runCli(['node', 'zcc', 'followup', 'ls', '--status', 'bogus'], { dataDir: fixtureDir });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('must be one of');
  });

  it('lists follow-up ls in help', async () => {
    const result = await runCli(['node', 'zcc', '--help'], { dataDir: fixtureDir });
    expect(result.stdout).toContain('followup ls');
  });

  it('value-less --data-dir is a usage error (exit 2)', async () => {
    // Trailing --data-dir with no path.
    const trailing = await runCli(['node', 'zcc', '--data-dir']);
    expect(trailing.exitCode).toBe(2);
    expect(trailing.stderr).toContain('--data-dir requires a path');

    // --data-dir immediately followed by another flag (adversarial).
    const beforeFlag = await runCli(['node', 'zcc', '--data-dir', '--json', 'projects', 'ls']);
    expect(beforeFlag.exitCode).toBe(2);
    expect(beforeFlag.stderr).toContain('--data-dir requires a path');

    // Empty equals-form.
    const emptyEq = await runCli(['node', 'zcc', '--data-dir=', 'projects', 'ls']);
    expect(emptyEq.exitCode).toBe(2);
    expect(emptyEq.stderr).toContain('--data-dir requires a path');
  });

  it('handles unknown command', async () => {
    const result = await runCli(['node', 'zcc', 'unknown', 'cmd'], { dataDir: fixtureDir });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/not running|unknown command/);
  });

  it('term close-summary rejects missing args with usage exit code', async () => {
    const noProject = await runCli(['node', 'zcc', 'term', 'close-summary'], { dataDir: fixtureDir });
    expect(noProject.exitCode).toBe(2);
    expect(noProject.stderr).toContain('requires <projectId>');

    const noSessions = await runCli(['node', 'zcc', 'term', 'close-summary', 'proj-001'], {
      dataDir: fixtureDir
    });
    expect(noSessions.exitCode).toBe(2);
  });

  it('lists term close-summary in help', async () => {
    const result = await runCli(['node', 'zcc', '--help'], { dataDir: fixtureDir });
    expect(result.stdout).toContain('term close-summary');
  });

  it('lists no projects when the API returns an empty set', async () => {
    const result = await runCli(['node', 'zcc', 'projects', 'ls'], {
      dataDir: '/nonexistent',
      fetchImpl: projectsFetch([])
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('No projects');
  });

  it('supports short ID prefix matching for inbox show', async () => {
    // Prefix 'inbox-0' matches both entries; first match is inbox-001
    const result = await runCli(['node', 'zcc', 'inbox', 'show', 'inbox-001'], { dataDir: fixtureDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Inbox Entry: inbox-001');
  });

  it('warns when an inbox show prefix is ambiguous', async () => {
    // 'inbox-' is a prefix of both fixture entries — should resolve to one
    // but warn the user it was ambiguous.
    const result = await runCli(['node', 'zcc', 'inbox', 'show', 'inbox-'], { dataDir: fixtureDir });
    expect(result.exitCode).toBe(0);
    expect(result.stderr ?? '').toContain('matches');
  });

  it('honors the --data-dir flag (space form) over the default', async () => {
    const result = await runCli(['node', 'zcc', '--data-dir', fixtureDir, 'inbox', 'ls', '--json']);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
  });

  it('honors the --data-dir=<path> flag (equals form)', async () => {
    const result = await runCli(['node', 'zcc', `--data-dir=${fixtureDir}`, 'schedule', 'ls']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain('No schedules found');
  });

  it('lists a single project from the product API', async () => {
    const result = await runCli(['node', 'zcc', 'projects', 'ls', '--json'], {
      fetchImpl: projectsFetch([
        { id: 'v0proj', name: 'Legacy Project', path: '/tmp/legacy' }
      ])
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('v0proj');
  });

  it('reports APP_NOT_RUNNING when the product API is unreachable', async () => {
    const result = await runCli(['node', 'zcc', 'projects', 'ls'], {
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      }
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/not running/);
  });
});
