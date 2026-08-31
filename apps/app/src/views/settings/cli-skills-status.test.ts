import { describe, expect, it } from 'vitest';
import {
  cliSkillBulkLabel,
  cliSkillInstallError,
  cliSkillPresentation,
  pendingCliSkillHostIds,
  type CliSkillMachineRow
} from './cli-skills-status.js';

function row(
  status: CliSkillMachineRow['status'],
  hostId: string = status,
  hostName: string = hostId
): CliSkillMachineRow {
  return { hostId, hostName, status };
}

describe('cliSkillPresentation', () => {
  it('treats installed as current with no action', () => {
    expect(cliSkillPresentation('installed')).toEqual({
      label: 'Installed',
      hint: 'Current zcc-cli skill on this machine',
      tone: 'ok',
      action: null,
      actionLabel: null
    });
  });

  it('offers Update for an outdated copy', () => {
    expect(cliSkillPresentation('outdated').actionLabel).toBe('Update');
    expect(cliSkillPresentation('outdated').tone).toBe('warn');
  });

  it('offers Install when the skill is missing', () => {
    expect(cliSkillPresentation('missing').actionLabel).toBe('Install');
    expect(cliSkillPresentation('missing').label).toBe('Not installed');
  });

  it('hides the action when the machine cannot be checked', () => {
    expect(cliSkillPresentation('unknown').action).toBeNull();
    expect(cliSkillPresentation('unknown').tone).toBe('muted');
  });
});

describe('pendingCliSkillHostIds', () => {
  it('returns only machines that can be installed or updated', () => {
    expect(
      pendingCliSkillHostIds([
        row('installed', 'a'),
        row('outdated', 'b'),
        row('missing', 'c'),
        row('unknown', 'd')
      ])
    ).toEqual(['b', 'c']);
  });
});

describe('cliSkillBulkLabel', () => {
  it('hides the bulk action for a single pending machine', () => {
    expect(cliSkillBulkLabel([row('outdated')])).toBeNull();
    expect(cliSkillBulkLabel([row('installed'), row('missing', 'm')])).toBeNull();
  });

  it('says Install all when every pending machine is missing', () => {
    expect(cliSkillBulkLabel([row('missing', 'a'), row('missing', 'b')])).toBe('Install all (2)');
  });

  it('says Update all when any pending machine is outdated', () => {
    expect(cliSkillBulkLabel([row('outdated', 'a'), row('missing', 'b')])).toBe('Update all (2)');
  });
});

describe('cliSkillInstallError', () => {
  it('returns null when every host succeeded', () => {
    expect(cliSkillInstallError([{ ok: true, hostName: 'box' }])).toBeNull();
  });

  it('joins failed host names and messages', () => {
    expect(
      cliSkillInstallError([
        { ok: true, hostName: 'ok' },
        { ok: false, hostName: 'box', errorMessage: 'offline' },
        { ok: false, hostName: 'lab' }
      ])
    ).toBe('box: offline · lab: failed');
  });
});
