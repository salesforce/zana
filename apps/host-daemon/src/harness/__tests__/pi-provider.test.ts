import { describe, it, expect } from 'vitest';
import { providerFor } from '../registry.js';
import { PiProvider } from '../pi/provider.js';
import type { AppConfig, ProjectRemote } from '@zana-ai/zcc-domain/product';

const CONFIG: AppConfig = {
  version: 1,
  theme: 'dark',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null
};

describe('registry.providerFor — pi family', () => {
  it('routes pi profiles to the PiProvider', () => {
    expect(providerFor('pi')).toBeInstanceOf(PiProvider);
    expect(providerFor('pi-resume')).toBeInstanceOf(PiProvider);
  });

  it('reuses ONE instance per family (built once, Rule 3)', () => {
    expect(providerFor('pi')).toBe(providerFor('pi-resume'));
  });

  it('has a stable provider id', () => {
    expect(providerFor('pi').id).toBe('pi');
  });
});

describe('PiProvider', () => {
  const p = new PiProvider();
  const remote: ProjectRemote = { host: 'devbox', user: 'sfwork', remotePath: '/home/sfwork/core' };

  it('resolveLaunch: bare pi, no args', () => {
    expect(p.resolveLaunch('pi', CONFIG, false)).toEqual({ command: 'pi', args: [] });
  });

  it('resolveLaunch: pi-resume prepends --continue', () => {
    expect(p.resolveLaunch('pi-resume', CONFIG, false)).toEqual({
      command: 'pi',
      args: ['--continue']
    });
  });

  it('honors the configured piBinary path', () => {
    const cfg: AppConfig = { ...CONFIG, piBinary: '/opt/pi/pi' };
    expect(p.resolveLaunch('pi', cfg, false).command).toBe('/opt/pi/pi');
  });

  it('folds the launcher-global provider/model/thinking defaults into base argv', () => {
    const cfg: AppConfig = {
      ...CONFIG,
      piProvider: 'anthropic',
      piModel: 'anthropic/claude-opus-4-8',
      piThinking: 'high'
    };
    expect(p.resolveLaunch('pi', cfg, false)).toEqual({
      command: 'pi',
      args: ['--provider', 'anthropic', '--model', 'anthropic/claude-opus-4-8', '--thinking', 'high']
    });
  });

  it('emits only the defaults that are set (byte-clean when unset)', () => {
    const cfg: AppConfig = { ...CONFIG, piModel: 'sonnet' };
    expect(p.resolveLaunch('pi', cfg, false)).toEqual({ command: 'pi', args: ['--model', 'sonnet'] });
  });

  it('pi-resume keeps --continue first, then the defaults', () => {
    const cfg: AppConfig = { ...CONFIG, piProvider: 'openai', piThinking: 'max' };
    expect(p.resolveLaunch('pi-resume', cfg, false)).toEqual({
      command: 'pi',
      args: ['--continue', '--provider', 'openai', '--thinking', 'max']
    });
  });

  it('remote command carries the launcher-global defaults too', () => {
    const cfg: AppConfig = { ...CONFIG, piProvider: 'google', piModel: 'gemini-3.1-pro-preview' };
    const { cmd } = p.buildRemoteCommand({ profile: 'pi', config: cfg, remote });
    expect(cmd).toBe(
      `cd '/home/sfwork/core' && exec 'pi' '--provider' 'google' '--model' 'gemini-3.1-pro-preview'`
    );
  });

  it('arg builders are no-ops (v1: no launcher-injectable flags)', () => {
    expect(p.personaArgs({ id: 'p', name: 'P', appendSystemPrompt: 'x' }, 'pi')).toEqual([]);
    expect(p.projectSettingsArgs({ model: 'opus' }, 'pi')).toEqual([]);
    expect(p.mcpArgs('pi', 'http://127.0.0.1/mcp/p/s')).toEqual([]);
    expect(p.guidanceArgs('pi', 'Be concise.')).toEqual([]);
    expect(p.hookArgs('pi', { stop: 'http://h/hook/stop/p/s' })).toEqual([]);
  });

  it('emits project provider, model, and thinking overrides', () => {
    expect(p.projectSettingsArgs({
      piProvider: 'anthropic', piModel: 'claude-opus-4-8', piThinking: 'high'
    }, 'pi')).toEqual([
      '--provider', 'anthropic', '--model', 'claude-opus-4-8', '--thinking', 'high'
    ]);
  });

  it('auth injection is empty (PI authenticates via its own /login)', () => {
    expect(p.authKey('pi')).toBeNull();
    expect(p.authInjection('pi', { baseUrl: 'https://x', token: 'k' })).toEqual({});
  });

  it('auto-mode always off', () => {
    expect(p.computeAutoModeActive({ profile: 'pi', config: CONFIG, extraArgs: [] })).toBe(false);
  });

  it('baseArgsPinSession true only for pi-resume', () => {
    expect(p.baseArgsPinSession('pi-resume')).toBe(true);
    expect(p.baseArgsPinSession('pi')).toBe(false);
  });

  it('capabilities: agent + promptArgv, no launcher-injected flags', () => {
    const caps = p.capabilities('pi');
    expect(caps.isAgent).toBe(true);
    expect(caps.acceptsPromptArgv).toBe(true);
    expect(caps.hasTranscript).toBe(false);
    expect(caps.injectsClaudeMcpConfig).toBe(false);
    expect(caps.supportsHooks).toBe(false);
    expect(caps.acceptsSessionId).toBe(false);
    expect(caps.acceptsPermissionMode).toBe(false);
    expect(caps.canAutoCloseOnFinish).toBe(false);
    // pi prints no OSC status glyph → the output-activity heuristic drives it.
    expect(caps.emitsOscStatus).toBe(false);
  });

  it('remote command cds and execs pi', () => {
    expect(p.buildRemoteCommand({ profile: 'pi', config: CONFIG, remote }).cmd).toBe(
      `cd '/home/sfwork/core' && exec 'pi'`
    );
  });

  it('remote command carries --continue for pi-resume + trailing extraArgs', () => {
    const { cmd } = p.buildRemoteCommand({
      profile: 'pi-resume',
      config: CONFIG,
      remote,
      extraArgs: ['hello world']
    });
    expect(cmd).toBe(`cd '/home/sfwork/core' && exec 'pi' '--continue' 'hello world'`);
  });

  it('title maps each profile', () => {
    expect(p.title('pi')).toBe('pi');
    expect(p.title('pi-resume')).toBe('pi --continue');
  });
});
