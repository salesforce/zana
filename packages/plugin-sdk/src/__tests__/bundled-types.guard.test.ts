import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const read = (...parts: string[]) => readFileSync(join(here, ...parts), 'utf8');
const serverSource = read('..', 'server.ts');
const bundledDts = read('..', '..', 'bundled-types', 'zcc-plugin-sdk.d.ts');
const referenceDoc = read('..', '..', '..', '..', 'docs', 'extensions-sdk-reference.md');

/** Member names declared directly in `export interface <name> { ... }`, skipping deprecated and experimental_ aliases. */
export function interfaceMembers(source: string, name: string): string[] {
  const start = source.indexOf(`export interface ${name} {`);
  if (start < 0) throw new Error(`interface ${name} not found`);
  const body = source.slice(start).split(/\n}\n/)[0]!.split('\n');
  const members: string[] = [];
  let deprecated = false;
  for (const line of body.slice(1)) {
    if (/@deprecated/.test(line)) deprecated = true;
    const match = /^ {2}(?:readonly )?([A-Za-z_][A-Za-z0-9_]*)[?(:<]/.exec(line);
    if (!match) continue;
    if (!deprecated && !match[1]!.startsWith('experimental_')) members.push(match[1]!);
    deprecated = false;
  }
  return members;
}

const SURFACES: Array<[interfaceName: string, prefix: string]> = [
  ['ZccPluginApi', 'zcc.'],
  ['PluginHooks', 'zcc.hooks.'],
  ['PluginUi', 'zcc.ui.'],
  ['PluginAgents', 'zcc.agents.'],
  ['PluginEvents', 'zcc.events.'],
  ['PluginHostApi', 'zcc.host.']
];

describe('bundled SDK types and reference doc cover the public API', () => {
  it('finds members to check', () => {
    expect(interfaceMembers(serverSource, 'ZccPluginApi')).toEqual(expect.arrayContaining(['hooks', 'ui', 'agents', 'host']));
  });

  for (const [interfaceName, prefix] of SURFACES) {
    for (const member of interfaceMembers(serverSource, interfaceName)) {
      it(`${prefix}${member} is in the bundled d.ts and the reference doc`, () => {
        expect(bundledDts, `bundled d.ts lacks ${member}`).toMatch(new RegExp(`\\b${member}\\b`));
        const topLevel = prefix === 'zcc.';
        const documented = topLevel
          ? new RegExp(`\`(?:zcc\\.)?${member}[\`.(]`)
          : new RegExp(`[\`./ ]${member}\\b`);
        expect(referenceDoc, `reference doc lacks ${prefix}${member}`).toMatch(documented);
      });
    }
  }

  it('carries the policy, admission, lifecycle and interaction shapes', () => {
    for (const fragment of [
      "action: 'ask'; prompt: string; timeoutMs?: number",
      "surface?: 'pty' | 'modern'",
      "'squad-member-start'",
      "'job-team-dispatch'",
      "export type DispatchOrigin = 'user' | 'agent' | 'system'",
      "surface?: 'modern' | 'pty'",
      "surface?: 'pty'",
      'sdk.capabilities'.split('.')[1]!
    ]) expect(bundledDts, fragment).toContain(fragment);
  });

  it('fails when a member is missing from the d.ts', () => {
    const without = bundledDts.replace(/registerProjectTabAvailability/g, 'removed');
    expect(without).not.toMatch(/\bregisterProjectTabAvailability\b/);
  });
});
