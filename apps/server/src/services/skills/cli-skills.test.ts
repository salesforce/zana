import { describe, expect, it } from 'vitest';
import { hashSkillContent, statusFromEntries } from './cli-skills.js';

describe('cli skill status aggregation', () => {
  it('treats matching hashes as installed and mixed/missing as outdated or missing', () => {
    const hash = hashSkillContent('# zcc-cli\n');
    expect(statusFromEntries([
      { name: 'zcc-cli', path: '/a', installed: true, hash },
      { name: 'zcc-cli', path: '/b', installed: true, hash }
    ], hash)).toBe('installed');
    expect(statusFromEntries([
      { name: 'zcc-cli', path: '/a', installed: false, hash: null },
      { name: 'zcc-cli', path: '/b', installed: false, hash: null }
    ], hash)).toBe('missing');
    expect(statusFromEntries([
      { name: 'zcc-cli', path: '/a', installed: true, hash },
      { name: 'zcc-cli', path: '/b', installed: false, hash: null }
    ], hash)).toBe('outdated');
    expect(statusFromEntries([
      { name: 'zcc-cli', path: '/a', installed: true, hash: 'deadbeef' },
      { name: 'zcc-cli', path: '/b', installed: true, hash: 'deadbeef' }
    ], hash)).toBe('outdated');
  });
});
