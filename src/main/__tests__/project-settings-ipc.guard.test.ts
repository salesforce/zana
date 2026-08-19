import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');

describe('project settings IPC failure handling', () => {
  it('keeps reads safe but lets mutation failures reject', () => {
    expect(source).toMatch(/safeHandle\(\s*IPC\.projectSettings\.get,[\s\S]*?\(\) => \(\{\} as ProjectSettings\)\s*\);/);
    expect(source).toMatch(/ipcMain\.handle\(IPC\.projectSettings\.set,[\s\S]*?runtimeSupervisor\s*\? runtimeSupervisor\.setProjectSettings\(id, patch\)[\s\S]*?: \(\(\) => \{[\s\S]*?store\.setProjectSettings\(id, patch\)[\s\S]*?safeSend\(IPC\.projectSettings\.onChanged, id\)[\s\S]*?\}\)\(\)\s*\);/);
    expect(source).not.toMatch(/safeHandle[^;]*IPC\.projectSettings\.set/);
  });

  it('reads server-owned settings for launch preflight and commit revalidation', () => {
    expect(source).toMatch(/async function getAuthoritativeProjectSettings[\s\S]*?runtimeSupervisor\.getProjectSettings/);
    expect(source).toMatch(/async function launchAuthorizedTerminal[\s\S]*?await getAuthoritativeProjectSettings\(req\.projectId\)/);
    expect(source).toMatch(/async function revalidateTerminalCommit[\s\S]*?await getAuthoritativeProjectSettings\(project\.id\)/);
    expect(source).toMatch(/async function launchBackgroundTerminal[\s\S]*?await getAuthoritativeProjectSettings\(project\.id\)/);
  });
});
