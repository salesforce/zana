import { expect, it, vi } from 'vitest';

// registerIpcFamilies is only a fan-out: bind the host ctx first, then register
// every IPC family once. Each family module is stubbed so this stays a pure
// wiring check (host-wiring-bootstrap.test.ts mocks this module as a whole).
const calls = vi.hoisted(() => [] as string[]);
const family = (name: string) => () => { calls.push(name); };

vi.mock('./ctx.js', () => ({ bindIpcCtx: (ctx: unknown) => { calls.push(`bind:${(ctx as { id: string }).id}`); } }));
vi.mock('./projects.js', () => ({ registerProjectsIpc: family('projects') }));
vi.mock('./windows.js', () => ({ registerWindowsIpc: family('windows') }));
vi.mock('./terminals.js', () => ({ registerTerminalsIpc: family('terminals') }));
vi.mock('./config.js', () => ({ registerConfigIpc: family('config') }));
vi.mock('./execution.js', () => ({ registerExecutionIpc: family('execution') }));
vi.mock('./execution-board.js', () => ({ registerExecutionBoardIpc: family('execution-board') }));
vi.mock('./sessions.js', () => ({ registerSessionsIpc: family('sessions') }));
vi.mock('./fs.js', () => ({ registerFsIpc: family('fs') }));
vi.mock('./inbox.js', () => ({ registerInboxIpc: family('inbox') }));
vi.mock('./agents.js', () => ({ registerAgentsIpc: family('agents') }));
vi.mock('./saved.js', () => ({ registerSavedIpc: family('saved') }));
vi.mock('./plugins.js', () => ({ registerPluginsIpc: family('plugins') }));
vi.mock('./extensions.js', () => ({ registerExtensionsIpc: family('extensions') }));
vi.mock('./skills.js', () => ({ registerSkillsIpc: family('skills') }));
vi.mock('./settings.js', () => ({ registerSettingsIpc: family('settings') }));
vi.mock('./app.js', () => ({ registerAppIpc: family('app') }));
vi.mock('./scheduler.js', () => ({ registerSchedulerIpc: family('scheduler') }));
vi.mock('./personas.js', () => ({ registerPersonasIpc: family('personas') }));
vi.mock('./voice.js', () => ({ registerVoiceIpc: family('voice') }));
vi.mock('./modules.js', () => ({ registerModulesIpc: family('modules') }));
vi.mock('./mobile.js', () => ({ registerMobileIpc: family('mobile') }));
vi.mock('./api-error-resume.js', () => ({ registerApiErrorResumeIpc: family('api-error-resume') }));

it('binds the host ctx before registering every IPC family once', async () => {
  const { registerIpcFamilies } = await import('./register.js');
  registerIpcFamilies({ id: 'host' } as never);
  expect(calls[0]).toBe('bind:host');
  expect(calls).toContain('api-error-resume');
  expect(calls).toHaveLength(23);
  expect(new Set(calls).size).toBe(calls.length);
});
