import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../extensions.ts', import.meta.url), 'utf8');

describe('git plugin install IPC', () => {
  it('dual-routes package.json zcc repos through PluginService and leftover extension.json through installFromDir', () => {
    expect(source).toMatch(/source\.kind === 'git'/);
    expect(source).toMatch(/isZccPluginWorkingDir\(staged\)/);
    expect(source).toMatch(/isZccPluginWorkingDir\(staged\)[\s\S]{0,1200}installPlugin\(/);
    expect(source).toMatch(/source\.kind === 'git'[\s\S]*?installFromDir\(/);
    expect(source).toMatch(/source\.kind === 'git'[\s\S]*?markGit\(/);
  });
});
