import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isLoopbackHttpHost,
  readBrowserBootstrap,
  toBrowserProjectSummaries
} from './browser-bootstrap.js';

describe('browser bootstrap projection', () => {
  it('keeps only id/name/display fields and drops filesystem paths', () => {
    expect(
      toBrowserProjectSummaries([
        {
          id: 'p1',
          name: 'One',
          path: '/secret/one',
          color: '#2f81f7',
          tag: 'one',
          category: 'Work'
        },
        { id: '', name: 'skipped' },
        { name: 'no-id' },
        null
      ])
    ).toEqual([
      { id: 'p1', name: 'One', color: '#2f81f7', tag: 'one', category: 'Work' }
    ]);
    expect(toBrowserProjectSummaries(undefined)).toEqual([]);
  });

  it('reads a projects.json file and ignores a missing catalogue', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-browser-bootstrap-'));
    const file = join(dir, 'projects.json');
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        projects: [{ id: 'p1', name: 'Local', path: '/tmp/local', color: '#3fb950' }]
      })
    );
    expect(readBrowserBootstrap({ projectsFile: file, appVersion: '1.2.3' })).toEqual({
      appVersion: '1.2.3',
      projects: [{ id: 'p1', name: 'Local', color: '#3fb950' }]
    });
    expect(
      readBrowserBootstrap({ projectsFile: join(dir, 'missing.json'), appVersion: '' }).projects
    ).toEqual([]);
  });

  it('accepts only loopback Host headers', () => {
    expect(isLoopbackHttpHost('localhost:5173')).toBe(true);
    expect(isLoopbackHttpHost('127.0.0.1:8080')).toBe(true);
    expect(isLoopbackHttpHost('[::1]:5173')).toBe(true);
    expect(isLoopbackHttpHost('example.com')).toBe(false);
    expect(isLoopbackHttpHost(undefined)).toBe(false);
  });
});
