import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every main-owned CLI spawn site must resolve the persona skill allowlist and hand it
 * to the spawn; a path that forgets it silently launches the agent unrestricted
 * (the background/scheduler path did once).
 */
const source = readFileSync(join(__dirname, '..', 'host.ts'), 'utf8');

function body(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  expect(start, `${startMarker} present`).toBeGreaterThan(-1);
  const end = source.indexOf(endMarker, start);
  expect(end, `${endMarker} after ${startMarker}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('skill allowlist reaches every CLI spawn site', () => {
  it('interactive/authorized launch resolves settings before createTerminalConfined', () => {
    const block = body('async function launchAuthorizedTerminal(', 'async function launchBackgroundTerminal(');
    expect(block).toMatch(/resolveCliSkillSettings\(/);
    expect(block).toMatch(/createTerminalConfined\([\s\S]*?\bskillSettings\b/);
  });

  it('background/scheduler launch resolves settings before ptys.create', () => {
    const block = body('async function launchBackgroundTerminal(', 'function createTerminalFromAuthorizedPlan(');
    const resolveAt = block.indexOf('resolveCliSkillSettings(');
    const spawnAt = block.indexOf('createTerminalFromAuthorizedPlan({');
    expect(resolveAt).toBeGreaterThan(-1);
    expect(spawnAt).toBeGreaterThan(resolveAt);
    expect(block.slice(spawnAt)).toMatch(/\.\.\.\(skillSettings \? \{ skillSettings \} : \{\}\)/);
  });
});
