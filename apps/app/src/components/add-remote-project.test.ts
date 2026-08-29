import { describe, expect, it } from 'vitest';
import { collectBootstrapLogs, remoteAddSubmitLabel } from './add-remote-project.js';

describe('add remote project helpers', () => {
  it('labels submit as add-and-install by default', () => {
    expect(remoteAddSubmitLabel({ installHost: true, installing: false, retry: false }))
      .toBe('Add and install');
    expect(remoteAddSubmitLabel({ installHost: false, installing: false, retry: false }))
      .toBe('Add project');
    expect(remoteAddSubmitLabel({ installHost: true, installing: true, retry: false }))
      .toBe('Installing…');
    expect(remoteAddSubmitLabel({ installHost: true, installing: false, retry: true }))
      .toBe('Retry install');
  });

  it('collects bootstrap log lines in order', () => {
    expect(collectBootstrapLogs([
      { type: 'log', text: 'Installing host daemon over SSH…' },
      { type: 'log' },
      { type: 'done', text: 'ignore' },
      { type: 'log', text: 'Waiting for the remote daemon to connect…' }
    ])).toEqual([
      'Installing host daemon over SSH…',
      'Waiting for the remote daemon to connect…'
    ]);
  });
});
