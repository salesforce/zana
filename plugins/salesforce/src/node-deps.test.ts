import { mkdtempSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNodeDeps } from '../lib/node-deps.js';

describe('node filesystem deps', () => {
  it('stats, reads, and lists a real temp directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-sf-'));
    const file = join(dir, 'sfdx-project.json');
    try {
      writeFileSync(file, '{"packageDirectories":[]}');
      const deps = createNodeDeps();
      expect(deps.now()).toBeGreaterThan(0);
      expect(deps.exists(file)).toBe(true);
      expect(deps.stat(file)).toBe('file');
      expect(deps.stat(dir)).toBe('dir');
      expect(deps.stat(join(dir, 'missing'))).toBe('missing');
      expect(deps.readFile(file)).toContain('packageDirectories');
      expect(deps.readFile(join(dir, 'missing'))).toBeNull();
      expect(deps.readdir(dir)).toContain('sfdx-project.json');
      expect(deps.realpath(file)).toContain('sfdx-project.json');
      deps.writeFile(join(dir, 'Bot.agent'), 'agent');
      expect(deps.readFile(join(dir, 'Bot.agent'))).toBe('agent');
      expect(statSync(join(dir, 'Bot.agent')).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
