import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveAllLaunch } from './launch-options.js';
import { resolveLaunchApproval } from './squad-proposal.js';
import { resolveThreadNotifications } from './notification-levels.js';
import { effectiveSkills } from './product.js';
import {
  LAYER_LABELS,
  SETTING_PRECEDENCE,
  getSettingPrecedence,
  hasOrderStrip,
  precedenceHelp
} from './setting-precedence.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('setting precedence table', () => {
  it('has unique keys, labelled layers and no duplicate layers per row', () => {
    const keys = SETTING_PRECEDENCE.map((row) => row.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const row of SETTING_PRECEDENCE) {
      expect(new Set(row.layers).size).toBe(row.layers.length);
      for (const layer of row.layers) expect(LAYER_LABELS[layer]).toBeTruthy();
    }
  });

  it('cites argv-built rows at lines that still contain the evidence', () => {
    for (const row of SETTING_PRECEDENCE) {
      if (!('evidence' in row)) continue;
      for (const item of row.evidence) {
        const lines = readFileSync(resolve(repoRoot, item.file), 'utf8').split('\n');
        expect(lines[item.line - 1], `${row.key} -> ${item.file}:${item.line}`).toContain(item.contains);
      }
    }
  });

  it('shows a strip only for first-defined rows', () => {
    expect(hasOrderStrip(getSettingPrecedence('launch.options'))).toBe(true);
    expect(hasOrderStrip(getSettingPrecedence('claude.permissionMode'))).toBe(false);
    expect(hasOrderStrip(getSettingPrecedence('tools.allowedDenied'))).toBe(false);
    expect(hasOrderStrip(getSettingPrecedence('squad.launchApproval'))).toBe(false);
  });

  it('throws on an unknown key', () => {
    expect(() => getSettingPrecedence('nope' as never)).toThrow(/Unknown setting precedence key/);
  });

  it('generates help from the table', () => {
    expect(precedenceHelp('launch.options')).toContain('This launch, then Plan, then Squad, then Built-in default');
    expect(precedenceHelp('tools.allowedDenied')).toContain('Layers combine.');
    expect(precedenceHelp('claude.permissionMode')).toContain('The last value given wins.');
    expect(precedenceHelp('squad.launchApproval')).toContain('The strictest layer wins.');
    // Row without a note.
    expect(precedenceHelp('squad.routingEnforced')).toBe(
      'Checked first to last: Squad, then Global. The first layer that sets a value wins.'
    );
  });
});

describe('resolver contract: launch.options', () => {
  const layers = getSettingPrecedence('launch.options').layers;

  it('matches the resolver order launch > plan > squad > default', () => {
    expect(layers).toEqual(['launch', 'plan', 'squad', 'default']);
    const all = { launch: { push: true }, plan: { push: false }, squad: { push: false } };
    expect(resolveAllLaunch(all).push.source).toBe('launch');
    expect(resolveAllLaunch({ plan: all.plan, squad: { push: true } }).push).toEqual({ value: false, source: 'plan' });
    expect(resolveAllLaunch({ squad: { push: true } }).push).toEqual({ value: true, source: 'squad' });
    expect(resolveAllLaunch({}).push).toEqual({ value: false, source: 'default' });
  });

  it('falls back to the Project/Global worktree default only below Squad', () => {
    expect(resolveAllLaunch({ fallback: { worktree: true } }).worktree).toEqual({ value: true, source: 'default' });
    expect(resolveAllLaunch({ squad: { worktreeIsolation: false }, fallback: { worktree: true } }).worktree)
      .toEqual({ value: false, source: 'squad' });
  });
});

describe('resolver contract: squad.launchApproval', () => {
  it('is a floor: either layer asking for review wins', () => {
    expect(resolveLaunchApproval({ squad: { launchApproval: 'direct' }, project: { launchApproval: 'review' } })).toBe('review');
    expect(resolveLaunchApproval({ squad: { launchApproval: 'review' }, project: { launchApproval: 'direct' } })).toBe('review');
    expect(resolveLaunchApproval({})).toBe('direct');
  });
});

describe('resolver contract: thread.notifications', () => {
  const defaults = { defaultLevel: 'all', childLevel: 'input-only' } as never;
  const child = { parentThreadId: 'p' };

  it('thread own > child default > global', () => {
    expect(getSettingPrecedence('thread.notifications').layers).toEqual(['thread', 'child-default', 'global']);
    expect(resolveThreadNotifications({ own: 'all', ancestorCap: null } as never, child, defaults).source).toBe('self');
    expect(resolveThreadNotifications({ own: 'inherit', ancestorCap: null } as never, child, defaults).source).toBe('child-default');
    expect(resolveThreadNotifications({ own: 'inherit', ancestorCap: null } as never, { parentThreadId: null }, defaults).source).toBe('global');
  });
});

describe('resolver contract: squad.leanWorkers', () => {
  it('persona skills > squad lean (workers only) > unrestricted', () => {
    expect(getSettingPrecedence('squad.leanWorkers').layers).toEqual(['persona', 'squad', 'default']);
    expect(effectiveSkills({ leanWorkers: true }, { skills: ['a'] }, 'worker')).toEqual(['zcc-inbox', 'a']);
    expect(effectiveSkills({ leanWorkers: true }, {}, 'worker')).toEqual(['zcc-inbox']);
    expect(effectiveSkills({ leanWorkers: true }, {}, 'orchestrator')).toBeUndefined();
    expect(effectiveSkills({}, {}, 'worker')).toBeUndefined();
  });
});

describe('squad.planning', () => {
  it('is first-wins: launch, then squad, then built-in', () => {
    expect(getSettingPrecedence('squad.planning').layers).toEqual(['launch', 'squad', 'default']);
    expect(hasOrderStrip(getSettingPrecedence('squad.planning'))).toBe(true);
  });
});

describe('resolver contract: launch.checkout', () => {
  it('launch > plan > squad > project/global fallback', () => {
    expect(getSettingPrecedence('launch.checkout').layers).toEqual(['launch', 'plan', 'squad', 'project', 'global']);
    expect(resolveAllLaunch({ launch: { worktree: false }, squad: { worktreeIsolation: true }, fallback: { worktree: true } }).worktree)
      .toEqual({ value: false, source: 'launch' });
    expect(resolveAllLaunch({ plan: { worktree: false }, squad: { worktreeIsolation: true } }).worktree)
      .toEqual({ value: false, source: 'plan' });
    expect(resolveAllLaunch({ squad: { worktreeIsolation: false }, fallback: { worktree: true } }).worktree)
      .toEqual({ value: false, source: 'squad' });
    expect(resolveAllLaunch({ fallback: { worktree: true } }).worktree).toEqual({ value: true, source: 'default' });
  });
});
