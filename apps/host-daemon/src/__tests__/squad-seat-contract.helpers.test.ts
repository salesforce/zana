import { describe, expect, it } from 'vitest';
import { providerFor } from '../harness/registry.js';
import { OpenCodeProvider } from '../harness/opencode/provider.js';
import { planSeatContract } from '../squad-seat-contract.js';

/** Internal helpers of the seat contract (#675) that the acceptance tests do not reach directly. */

describe('provider squadSeat declarations (D1)', () => {
  it.each([
    ['claude', { instructions: true, commandDeny: 'native', executionTools: true, foldPersonaIntoGuidance: false }],
    ['codex', { instructions: true, commandDeny: 'none', executionTools: true, foldPersonaIntoGuidance: true }],
    ['opencode', { instructions: true, commandDeny: 'none', executionTools: true, foldPersonaIntoGuidance: false }],
    ['cursor', { instructions: false, commandDeny: 'none', executionTools: false, foldPersonaIntoGuidance: false }],
    ['grok', { instructions: false, commandDeny: 'none', executionTools: false, foldPersonaIntoGuidance: false }],
    ['shell', { instructions: false, commandDeny: 'none', executionTools: false, foldPersonaIntoGuidance: false }]
  ] as const)('%s declares its seat capability', (profile, expected) => {
    expect(providerFor(profile as never).squadSeat).toEqual(expected);
  });
});

describe('OpenCode instructionsFile', () => {
  const p = new OpenCodeProvider();
  const url = 'http://127.0.0.1:1/mcp/p/s';

  it('adds the file to instructions in the inline and the file channel', () => {
    const inline = JSON.parse(p.mcpEnv('opencode', url, undefined, '/tmp/x/instr.md').OPENCODE_CONFIG_CONTENT);
    const file = JSON.parse(p.mcpConfigFile('opencode', url, undefined, '/tmp/x/instr.md').contents);
    expect(inline.instructions).toEqual(['/tmp/x/instr.md']);
    expect(file.instructions).toEqual(['/tmp/x/instr.md']);
    expect(inline.mcp['zcc-inbox'].url).toBe(url);
  });

  it('leaves both channels byte-identical without an instructions file', () => {
    const inline = p.mcpEnv('opencode', url).OPENCODE_CONFIG_CONTENT;
    expect(inline).toBe(JSON.stringify({ mcp: { 'zcc-inbox': { type: 'remote', url, enabled: true } } }));
    expect(p.mcpConfigFile('opencode', url).contents).toBe(inline);
  });

  it('passes instructionsFile from the integration request to both channels', () => {
    const out = p.integration.configure({ profile: 'opencode', mcp: { url }, instructionsFile: '/tmp/i.md' });
    expect(JSON.parse(out.mcpEnv!.OPENCODE_CONFIG_CONTENT!).instructions).toEqual(['/tmp/i.md']);
    expect(JSON.parse(out.mcpConfigFile!.contents).instructions).toEqual(['/tmp/i.md']);
    const plain = p.integration.configure({ profile: 'opencode', mcp: { url } });
    expect(JSON.parse(plain.mcpEnv!.OPENCODE_CONFIG_CONTENT!).instructions).toBeUndefined();
  });
});

describe('planSeatContract reserved commands and advisory mode (A1, A4)', () => {
  it.each(['curl', 'sh', 'dirname', 'pwd', 'printf'])('never shims %s, which Zana hooks or the shim script call through PATH', (command) => {
    const plan = planSeatContract({ persona: { deniedTools: [`Bash(${command}:*)`] } });
    expect(plan.shimFiles).toEqual([]);
    expect(plan.advisoryLines.join('\n')).toContain(`Bash(${command}:*)`);
  });

  it('lists every shimmable deny as advisory and plans no shim when the harness does not shim', () => {
    const plan = planSeatContract({ persona: { appendSystemPrompt: 'ROLE', deniedTools: ['Bash(gh:*)'] }, enforceShims: false });
    expect(plan.shimFiles).toEqual([]);
    expect(plan.instructionsText).toContain('ROLE');
    expect(plan.instructionsText).toContain('Denied by Squad policy, not mechanically enforced on this harness:');
    expect(plan.instructionsText).toContain('Bash(gh:*)');
  });
});
