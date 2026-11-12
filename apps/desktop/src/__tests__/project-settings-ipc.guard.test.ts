import { readFileSync } from 'node:fs';
import { parseAst } from 'vite';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../host.ts', import.meta.url), 'utf8');
const configIpc = readFileSync(new URL('../ipc/config.ts', import.meta.url), 'utf8');

interface Node {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

function assertProjectSettingsHandlers(text: string): void {
  const ast = parseAst(text, { lang: 'ts' }) as unknown as Node;
  const snippet = (node: Node): string => text.slice(node.start, node.end);
  const registrations: Node[] = [];
  const visit = (node: Node): void => {
    const args = node.arguments as Node[] | undefined;
    if (node.type === 'CallExpression' && args?.[0] && /^IPC\.projectSettings\.(get|set)$/.test(snippet(args[0]))) {
      registrations.push(node);
    }
    for (const value of Object.values(node)) {
      for (const child of Array.isArray(value) ? value : [value]) {
        if (child && typeof child === 'object' && typeof child.type === 'string') visit(child as Node);
      }
    }
  };
  visit(ast);
  expect(registrations).toHaveLength(2);
  const get = registrations.find((call) => snippet((call.arguments as Node[])[0]) === 'IPC.projectSettings.get')!;
  const set = registrations.find((call) => snippet((call.arguments as Node[])[0]) === 'IPC.projectSettings.set')!;
  expect(snippet(get.callee as Node)).toBe('safeProductHandle');
  const getArgs = get.arguments as Node[];
  const setArgs = set.arguments as Node[];
  expect(getArgs).toHaveLength(3);
  expect(snippet(getArgs[2])).toBe('() => ({} as ProjectSettings)');
  expect(snippet(set.callee as Node)).toBe('productHandle');
  expect(setArgs).toHaveLength(2);
  const handler = setArgs[1];
  expect(handler.type).toBe('ArrowFunctionExpression');
  // Match only the actual callback, not comments or unrelated handlers. This
  // narrow shape rejects catch/fallback wrappers and broadcasts before writes.
  expect(snippet(handler)).toMatch(/^\(id: string, patch: Partial<ProjectSettings>\) => \{\s*const parsed = ProjectSettingsPatchSchema\.parse\(patch\);\s*return ctx\.runtimeSupervisor\s*\? ctx\.runtimeSupervisor\.setProjectSettings\(id, parsed\)\s*: \(\(\) => \{\s*const settings = store\.setProjectSettings\(id, parsed\);\s*ctx\.safeSend\(IPC\.projectSettings\.onChanged, id\);\s*return settings;\s*\}\)\(\)\s*\}$/);
}

describe('project settings IPC failure handling', () => {
  it('keeps reads safe but lets mutation failures reject', () => {
    assertProjectSettingsHandlers(configIpc);
  });

  it('does not accept commented registrations or weakened mutation handlers', () => {
    const start = configIpc.indexOf('  productHandle(IPC.projectSettings.set,');
    const mutation = configIpc.slice(start, configIpc.lastIndexOf('\n}'));
    for (const text of [
      configIpc.slice(0, start) + `/* ${mutation} */\n}`,
      configIpc.replace('safeProductHandle(\n    IPC.projectSettings.get,', 'productHandle(\n    IPC.projectSettings.get,'),
      configIpc.replace('productHandle(IPC.projectSettings.set,', 'safeProductHandle(IPC.projectSettings.set,'),
      configIpc.replace('ProjectSettingsPatchSchema.parse(patch)', 'patch'),
      configIpc.replace('setProjectSettings(id, parsed)', 'setProjectSettings(id, patch)'),
      configIpc.replace('store.setProjectSettings(id, parsed)', 'store.setProjectSettings(id, patch)'),
      configIpc.replace('ctx.safeSend(IPC.projectSettings.onChanged, id);', ''),
      configIpc.replace('return settings;', 'return settings; } catch { return {}; }').replace('const settings = store.setProjectSettings', 'try { const settings = store.setProjectSettings'),
      configIpc.replace('const settings = store.setProjectSettings(id, parsed);', 'ctx.safeSend(IPC.projectSettings.onChanged, id); const settings = store.setProjectSettings(id, parsed);')
    ]) expect(() => assertProjectSettingsHandlers(text)).toThrow();
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
