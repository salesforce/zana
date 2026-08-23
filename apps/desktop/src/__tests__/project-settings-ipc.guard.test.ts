import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../host.ts', import.meta.url), 'utf8');
const configIpc = readFileSync(new URL('../ipc/config.ts', import.meta.url), 'utf8');

describe('project settings IPC failure handling', () => {
  it('keeps reads safe but lets mutation failures reject', () => {
    expect(configIpc).toMatch(/safeHandle\(\s*IPC\.projectSettings\.get,[\s\S]*?\(\) => \(\{\} as ProjectSettings\)\s*\);/);
    expect(configIpc).toMatch(/ipcMain\.handle\(IPC\.projectSettings\.set,[\s\S]*?ctx\.runtimeSupervisor\s*\?\s*ctx\.runtimeSupervisor\.setProjectSettings\(id, patch\)[\s\S]*?: \(\(\) => \{[\s\S]*?store\.setProjectSettings\(id, patch\)[\s\S]*?safeSend\(IPC\.projectSettings\.onChanged, id\)[\s\S]*?\}\)\(\)\s*\);/);
    expect(configIpc).not.toMatch(/safeHandle[^;]*IPC\.projectSettings\.set/);
  });

  it('reads server-owned settings for launch preflight and commit revalidation', () => {
    expect(source).toMatch(/async function getAuthoritativeProjectSettings[\s\S]*?runtimeSupervisor\.getProjectSettings/);
    expect(source).toMatch(/async function launchAuthorizedTerminal[\s\S]*?await getAuthoritativeProjectSettings\(req\.projectId\)/);
    expect(source).toMatch(/async function revalidateTerminalCommit[\s\S]*?await getAuthoritativeProjectSettings\(project\.id\)/);
    expect(source).toMatch(/async function launchBackgroundTerminal[\s\S]*?await getAuthoritativeProjectSettings\(project\.id\)/);
  });

  it('registers cloned directories through the product HTTP clone path', () => {
    expect(source).toMatch(/async function cloneAndRegisterProject[\s\S]*?api\/v1\/projects\/clone/);
    expect(source).toMatch(/cloneAndRegisterProject[\s\S]*?runtimeSupervisor \? await runtimeSupervisor\.listProjects\(\) as Project\[\] : store\.listProjects\(\)/);
  });

  it('registers agent-requested directories through the server after main authorizes the path', () => {
    expect(source).toMatch(/registerProject: async \(absPath: string\)[\s\S]*?realpathSync\(absPath\)/);
    expect(source).toMatch(/registerProject: async \(absPath: string\)[\s\S]*?runtimeSupervisor\s*\? await runtimeSupervisor\.addProject\(realTarget\)[\s\S]*?: store\.addProject\(realTarget\)/);
  });

  it('self-heals local extension projects through server add and bounded update operations', () => {
    expect(source).toMatch(/const registerExtensionProject = async[\s\S]*?runtimeSupervisor\s*\? await runtimeSupervisor\.addProject\(workingDir\)[\s\S]*?: store\.ensureExtensionProject\(workingDir, name\)/);
    expect(source).toMatch(/registerExtensionProject = async[\s\S]*?runtimeSupervisor\.updateProject\(project\.id, \{ category: EXTENSION_PROJECT_CATEGORY, name: label \}\)/);
  });

  it('closes legacy PTY sessions through PtyManager, not HTTP thread archive', () => {
    expect(source).toContain('ptys.closeExpected(sessionId)');
    expect(source).not.toContain('api/v1/threads/${encodeURIComponent(sessionId)}/archive');
    expect(source).not.toContain('completeThreadAtDataDir');
  });
});
