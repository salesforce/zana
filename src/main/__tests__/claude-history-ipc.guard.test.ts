import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Claude history IPC authority', () => {
  it('resolves a local project path in main instead of accepting renderer cwd', () => {
    const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
    const start = source.indexOf('IPC.claude.listSessions');
    const handler = source.slice(start, source.indexOf('IPC.opencode.listSessions', start));

    expect(handler).toContain("typeof projectId !== 'string'");
    expect(handler).toContain('store.listProjects().find((entry) => entry.id === projectId)');
    expect(handler).toContain('project && !project.remote ? listClaudeSessions(project.path) : []');
    expect(handler).not.toContain('(projectPath: string) => listClaudeSessions(projectPath)');
  });
});
