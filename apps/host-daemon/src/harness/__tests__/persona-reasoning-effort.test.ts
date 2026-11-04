import { describe, expect, it } from 'vitest';
import type { AppConfig, LaunchProfileId, Persona, ProjectRemote } from '@zana-ai/zcc-domain/product';
import { providerFor } from '../registry.js';

// #584: a persona reasoning effort maps to each harness's own launch setting.
// Absent = the argv is unchanged. Harnesses with no launch flag ignore it.
const CONFIG: AppConfig = { version: 1, theme: 'dark', shell: '/bin/zsh', claudeBinary: 'claude', fontSize: 13, lastProjectId: null };
const REMOTE: ProjectRemote = { host: 'devbox', remotePath: '/srv/app' };
const persona = (reasoningLevel?: Persona['reasoningLevel']): Persona =>
  ({ id: 'p', name: 'P', ...(reasoningLevel ? { reasoningLevel } : {}) });
const args = (profile: LaunchProfileId, level?: Persona['reasoningLevel']) =>
  providerFor(profile).personaArgs(persona(level), profile);

describe('persona reasoning effort per harness (#584)', () => {
  it.each(['codex', 'codex-resume', 'codex-yolo'] as const)('%s: -c model_reasoning_effort, value unchanged', (profile) => {
    for (const level of ['low', 'medium', 'high', 'xhigh', 'max'] as const) {
      expect(args(profile, level)).toEqual(['-c', `model_reasoning_effort="${level}"`]);
    }
    expect(args(profile)).toEqual([]);
  });

  it.each(['pi', 'pi-resume'] as const)('%s: --thinking, value unchanged', (profile) => {
    for (const level of ['low', 'medium', 'high', 'xhigh', 'max'] as const) {
      expect(args(profile, level)).toEqual(['--thinking', level]);
    }
    expect(args(profile)).toEqual([]);
  });

  it.each(['grok', 'grok-resume', 'grok-yolo'] as const)('%s: --reasoning-effort, xhigh and max step down to high', (profile) => {
    expect(args(profile, 'low')).toEqual(['--reasoning-effort', 'low']);
    expect(args(profile, 'medium')).toEqual(['--reasoning-effort', 'medium']);
    expect(args(profile, 'high')).toEqual(['--reasoning-effort', 'high']);
    expect(args(profile, 'xhigh')).toEqual(['--reasoning-effort', 'high']);
    expect(args(profile, 'max')).toEqual(['--reasoning-effort', 'high']);
    expect(args(profile)).toEqual([]);
  });

  it.each(['opencode', 'opencode-yolo', 'cursor', 'cursor-yolo', 'mastracode', 'shell'] as const)(
    '%s: no launch flag, so the level is ignored', (profile) => {
      expect(args(profile, 'max')).toEqual(args(profile));
    });

  it('the remote command carries the mapped flag for a simple-exec harness, and nothing without a level', () => {
    const remote = (profile: LaunchProfileId, level?: Persona['reasoningLevel']) =>
      providerFor(profile).buildRemoteCommand({ profile, config: CONFIG, remote: REMOTE, persona: persona(level) }).cmd;
    expect(remote('pi', 'high')).toContain("'--thinking' 'high'");
    expect(remote('grok', 'max')).toContain("'--reasoning-effort' 'high'");
    expect(remote('codex', 'xhigh')).toContain(`'-c' 'model_reasoning_effort="xhigh"'`);
    expect(remote('pi')).not.toContain('--thinking');
    expect(remote('codex')).not.toContain('model_reasoning_effort');
    expect(remote('cursor', 'max')).toBe(remote('cursor'));
  });
});
