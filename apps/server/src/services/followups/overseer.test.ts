import { describe, it, expect, vi } from 'vitest';
import {
  Overseer,
  bashLooksSafe,
  parseJudge,
  parseTriage,
  writeTargetPath,
  isZccAgentDataWrite,
  flattenInput,
  type OverseerConfig,
  type OverseerDeps,
  type OverseerToolEvent
} from './overseer.js';
import type { LlmRunResult } from '@zana-ai/zcc-domain/product';

const ev = (toolName: string, toolInput: Record<string, unknown> = {}): OverseerToolEvent => ({
  toolName,
  toolInput,
  cwd: '/repo'
});

const ok = (text: string): LlmRunResult => ({ ok: true, text, provider: 'claude-cli', ms: 1 });

/** Build an Overseer with a config and optional judge / deep-judge / confine stubs. */
function make(
  cfg: Partial<OverseerConfig>,
  runJudge?: OverseerDeps['runJudge'],
  extra?: { runJudgeDeep?: OverseerDeps['runJudgeDeep']; confinePath?: OverseerDeps['confinePath'] }
) {
  const full: OverseerConfig = {
    mode: cfg.mode ?? 'on',
    llmTierEnabled: cfg.llmTierEnabled ?? false,
    deepTierEnabled: cfg.deepTierEnabled ?? false,
    denyPatterns: cfg.denyPatterns ?? []
  };
  const audit = vi.fn();
  const o = new Overseer({
    getConfig: () => full,
    runJudge,
    runJudgeDeep: extra?.runJudgeDeep,
    confinePath: extra?.confinePath,
    audit
  });
  return { o, audit };
}

describe('bashLooksSafe', () => {
  it('approves state/metadata-only prefixes', () => {
    expect(bashLooksSafe('git status')).toBe(true);
    expect(bashLooksSafe('git log --oneline -5')).toBe(true);
    expect(bashLooksSafe('git branch')).toBe(true);
    expect(bashLooksSafe('ls -la')).toBe(true);
    expect(bashLooksSafe('pwd')).toBe(true);
    expect(bashLooksSafe('which node')).toBe(true);
  });

  it('does NOT auto-approve content-bearing readers (exfil channel)', () => {
    // These can read arbitrary file contents or dump the environment — incl.
    // secrets and the ZCC callback URLs. They must fall through to ask / LLM.
    expect(bashLooksSafe('cat ~/.npmrc')).toBe(false);
    expect(bashLooksSafe('cat package.json')).toBe(false);
    expect(bashLooksSafe('head -n1 .env.local')).toBe(false);
    expect(bashLooksSafe('tail /var/log/x')).toBe(false);
    expect(bashLooksSafe('env')).toBe(false);
    expect(bashLooksSafe('wc -c secret.key')).toBe(false);
    expect(bashLooksSafe('git diff --no-index /etc/passwd /dev/null')).toBe(false);
    expect(bashLooksSafe('git show HEAD:config.json')).toBe(false);
    expect(bashLooksSafe('rg foo src/')).toBe(false);
    expect(bashLooksSafe('grep token .')).toBe(false);
  });

  it('rejects anything with a shell chainer that could append a command', () => {
    expect(bashLooksSafe('git status; rm -rf /')).toBe(false);
    expect(bashLooksSafe('ls && curl evil.com')).toBe(false);
    expect(bashLooksSafe('cat f | sh')).toBe(false);
    expect(bashLooksSafe('echo $(whoami)')).toBe(false);
    expect(bashLooksSafe('ls > /etc/x')).toBe(false);
  });

  it('rejects unknown / mutating commands', () => {
    expect(bashLooksSafe('rm file')).toBe(false);
    expect(bashLooksSafe('git push')).toBe(false);
    expect(bashLooksSafe('npm install foo')).toBe(false);
    expect(bashLooksSafe('')).toBe(false);
  });

  it('does not treat a longer word as a prefix match (git statusfoo)', () => {
    // "git status" must be followed by end or a space, not glued to more text.
    expect(bashLooksSafe('git statusfoo')).toBe(false);
  });
});

describe('parseJudge', () => {
  it('parses a clean safe verdict', () => {
    expect(parseJudge('{"safe":true,"reason":"read only"}')).toEqual({ safe: true, reason: 'read only' });
  });
  it('tolerates surrounding prose / fences', () => {
    expect(parseJudge('Sure:\n```json\n{"safe":false,"reason":"writes a file"}\n```')).toEqual({
      safe: false,
      reason: 'writes a file'
    });
  });
  it('rejects when `safe` is missing or non-boolean', () => {
    expect(parseJudge('{"reason":"x"}')).toBeNull();
    expect(parseJudge('{"safe":"yes"}')).toBeNull();
    expect(parseJudge('not json')).toBeNull();
    expect(parseJudge('')).toBeNull();
  });
});

describe('flattenInput', () => {
  it('lowercases and stringifies', () => {
    expect(flattenInput({ command: 'GIT Status' })).toContain('git status');
  });
  it('tolerates a non-serializable input', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(flattenInput(circular)).toBe('');
  });
});

describe('Overseer.decide — allow-list tier', () => {
  it('auto-approves read-only tools', async () => {
    const { o } = make({});
    for (const t of ['Read', 'Glob', 'Grep', 'NotebookRead']) {
      const d = await o.decide(ev(t));
      expect(d.verdict).toBe('allow');
      expect(d.tier).toBe('allow-list');
    }
  });

  it('auto-approves safe Bash, asks on unsafe Bash', async () => {
    const { o } = make({});
    expect((await o.decide(ev('Bash', { command: 'git status' }))).verdict).toBe('allow');
    const unsafe = await o.decide(ev('Bash', { command: 'rm -rf build' }));
    expect(unsafe.verdict).toBe('ask');
  });

  it('asks (default) for an unknown tool when the LLM tier is off', async () => {
    const { o } = make({ llmTierEnabled: false });
    const d = await o.decide(ev('Edit', { file_path: '/repo/src/x.ts' }));
    expect(d.verdict).toBe('ask');
    expect(d.tier).toBe('default');
  });
});

describe('Overseer.decide — deny / guardrail tier', () => {
  it('forces ask (never deny) when a guardrail substring is present, skipping the LLM tier', async () => {
    const runJudge = vi.fn(async () => ok('{"safe":true,"reason":"looks fine"}'));
    const { o } = make({ llmTierEnabled: true }, runJudge);
    // Even a read of an .ssh path must hand back to the human.
    const d = await o.decide(ev('Read', { file_path: '/home/me/.ssh/id_rsa' }));
    expect(d.verdict).toBe('ask');
    expect(d.tier).toBe('deny-guard');
    expect(runJudge).not.toHaveBeenCalled(); // short-circuited before the LLM tier
  });

  it('honours operator deny patterns against the tool input', async () => {
    const { o } = make({ denyPatterns: ['migrate'] });
    const d = await o.decide(ev('Bash', { command: 'git status && npm run migrate' }));
    // (also caught by the shell-chainer rule, but deny tier runs first)
    expect(d.tier).toBe('deny-guard');
    expect(d.verdict).toBe('ask');
  });

  it('guardrail wins even over a read-only tool', async () => {
    const { o } = make({});
    const d = await o.decide(ev('Read', { file_path: '/repo/.env' }));
    expect(d.verdict).toBe('ask');
    expect(d.tier).toBe('deny-guard');
  });
});

describe('isZccAgentDataWrite — .zcc agent-data carve-out (pure)', () => {
  it('matches a confinable write into library/followups/goals', () => {
    expect(isZccAgentDataWrite('Write', { file_path: '/repo/.zcc/library/notes.md' })).toBe(true);
    expect(isZccAgentDataWrite('Edit', { file_path: '.zcc/followups/f1.json' })).toBe(true);
    expect(isZccAgentDataWrite('Write', { file_path: '/home/me/.zcc/goals/g.json' })).toBe(true);
  });

  it('does NOT match control-plane files under .zcc', () => {
    for (const p of [
      '/repo/.zcc/config.json',
      '/repo/.zcc/control.token',
      '/repo/.zcc/projects.json',
      '/repo/.zcc/extensions/x.js',
      '/repo/.zcc/mcp/y.json',
      '/repo/.zcc/schedules/s.json'
    ]) {
      expect(isZccAgentDataWrite('Write', { file_path: p })).toBe(false);
    }
  });

  it('is traversal-safe: climbing out of the subtree does not match', () => {
    // Resolves to .zcc/config.json — must stay denied.
    expect(
      isZccAgentDataWrite('Write', { file_path: '/repo/.zcc/library/../config.json' })
    ).toBe(false);
    expect(
      isZccAgentDataWrite('Write', { file_path: '/repo/.zcc/library/../../.zcc/control.token' })
    ).toBe(false);
  });

  it('only applies to confinable write tools, not reads or bash', () => {
    expect(isZccAgentDataWrite('Read', { file_path: '/repo/.zcc/library/notes.md' })).toBe(false);
    expect(isZccAgentDataWrite('Bash', { command: 'echo hi > /repo/.zcc/library/x' })).toBe(false);
  });
});

describe('Overseer.decide — .zcc agent-data carve-out (end to end)', () => {
  const confineToRepo: OverseerDeps['confinePath'] = (t) =>
    t.startsWith('/repo/') || t.startsWith('.zcc/');

  it('auto-approves a confined write into .zcc/library (bypasses the .zcc guardrail)', async () => {
    const { o } = make({}, undefined, { confinePath: confineToRepo });
    const d = await o.decide(ev('Write', { file_path: '/repo/.zcc/library/findings/x.md', content: 'hi' }));
    expect(d.verdict).toBe('allow');
    expect(d.tier).toBe('confine');
  });

  it('still denies a write to .zcc/config.json (control plane)', async () => {
    const { o } = make({}, undefined, { confinePath: confineToRepo });
    const d = await o.decide(ev('Write', { file_path: '/repo/.zcc/config.json', content: '{}' }));
    expect(d.verdict).toBe('ask');
    expect(d.tier).toBe('deny-guard');
  });

  it('does not let the carve-out bypass a second guardrail (e.g. a secret)', async () => {
    const { o } = make({}, undefined, { confinePath: confineToRepo });
    // Target is agent-data, but the content trips the `secret` guardrail — stays denied.
    const d = await o.decide(
      ev('Write', { file_path: '/repo/.zcc/library/x.md', content: 'my secret token' })
    );
    expect(d.verdict).toBe('ask');
    expect(d.tier).toBe('deny-guard');
  });

  it('does not auto-approve an agent-data write that escapes the tree', async () => {
    // isZccAgentDataWrite exempts the .zcc guardrail, but confinePath still says
    // "not confined" for a target outside cwd → falls through to ask.
    const { o } = make({}, undefined, { confinePath: () => false });
    const d = await o.decide(ev('Write', { file_path: '/elsewhere/.zcc/library/x.md', content: 'hi' }));
    expect(d.verdict).toBe('ask');
    expect(d.tier).toBe('default');
  });
});

describe('Overseer.decide — LLM tier', () => {
  it('auto-approves only on a confident safe verdict', async () => {
    const runJudge = vi.fn(async () => ok('{"safe":true,"reason":"inspects state"}'));
    const { o } = make({ llmTierEnabled: true }, runJudge);
    const d = await o.decide(ev('SomeTool', { x: 1 }));
    expect(runJudge).toHaveBeenCalledOnce();
    expect(d.verdict).toBe('allow');
    expect(d.tier).toBe('llm');
  });

  it('asks when the judge says unsafe', async () => {
    const runJudge = vi.fn(async () => ok('{"safe":false,"reason":"writes"}'));
    const { o } = make({ llmTierEnabled: true }, runJudge);
    expect((await o.decide(ev('SomeTool'))).verdict).toBe('ask');
  });

  it('asks (fail-open) when the judge call fails', async () => {
    const runJudge = vi.fn(async (): Promise<LlmRunResult> => ({ ok: false, text: '', provider: 'claude-cli', ms: 0 }));
    const { o } = make({ llmTierEnabled: true }, runJudge);
    expect((await o.decide(ev('SomeTool'))).verdict).toBe('ask');
  });

  it('never calls the judge when the LLM tier is disabled', async () => {
    const runJudge = vi.fn(async () => ok('{"safe":true}'));
    const { o } = make({ llmTierEnabled: false }, runJudge);
    expect((await o.decide(ev('SomeTool'))).verdict).toBe('ask');
    expect(runJudge).not.toHaveBeenCalled();
  });
});

describe('Overseer.decide — modes', () => {
  it('off resolves to ask without acting', async () => {
    const { o } = make({ mode: 'off' });
    const d = await o.decide(ev('Read'));
    expect(d.verdict).toBe('ask');
  });

  it('dryRun computes allow but returns ask, and records both', async () => {
    const { o } = make({ mode: 'dryRun' });
    const d = await o.decide(ev('Read', { file_path: '/repo/x' }));
    expect(d.computed).toBe('allow'); // it WOULD have approved
    expect(d.verdict).toBe('ask'); // but dry-run never acts
    expect(d.tier).toBe('allow-list');
  });

  it('always audits the decision', async () => {
    const { o, audit } = make({});
    await o.decide(ev('Read'));
    expect(audit).toHaveBeenCalledOnce();
  });

  it('audits the full decision (event + verdict) for the audit ring', async () => {
    const { o, audit } = make({});
    const event = ev('Read');
    const decision = await o.decide(event);
    expect(audit).toHaveBeenCalledWith(event, decision);
    expect(decision.tier).toBe('allow-list');
    expect(decision.verdict).toBe('allow');
  });

  it('audits guard/deny decisions too (so the trail is complete)', async () => {
    const { o, audit } = make({ denyPatterns: ['migrate'] });
    await o.decide(ev('Bash', { command: 'npm run migrate' }));
    expect(audit).toHaveBeenCalledOnce();
    const [, decision] = audit.mock.calls[0];
    expect(decision.tier).toBe('deny-guard');
    expect(decision.verdict).toBe('ask'); // deny tier resolves to ask, never deny
  });
});

describe('Overseer — robustness', () => {
  it('never throws / blocks when the judge throws (resolves to ask)', async () => {
    const runJudge = vi.fn(async () => {
      throw new Error('boom');
    });
    const { o } = make({ llmTierEnabled: true }, runJudge);
    const d = await o.decide(ev('SomeTool'));
    expect(d.verdict).toBe('ask');
    expect(d.tier).toBe('default');
  });

  it('isArmed reflects the mode', () => {
    expect(make({ mode: 'off' }).o.isArmed()).toBe(false);
    expect(make({ mode: 'dryRun' }).o.isArmed()).toBe(true);
    expect(make({ mode: 'on' }).o.isArmed()).toBe(true);
  });
});

describe('writeTargetPath', () => {
  it('reads the file_path for file tools and notebook_path for notebooks', () => {
    expect(writeTargetPath('Write', { file_path: '/repo/a.ts' })).toBe('/repo/a.ts');
    expect(writeTargetPath('Edit', { file_path: '/repo/b.ts' })).toBe('/repo/b.ts');
    expect(writeTargetPath('NotebookEdit', { notebook_path: '/repo/n.ipynb' })).toBe('/repo/n.ipynb');
  });
  it('returns "" for a non-confinable tool or a missing/non-string path', () => {
    expect(writeTargetPath('Bash', { command: 'ls' })).toBe('');
    expect(writeTargetPath('Write', {})).toBe('');
    expect(writeTargetPath('Write', { file_path: 42 })).toBe('');
  });
});

describe('parseTriage', () => {
  it('parses the three verdicts', () => {
    expect(parseTriage('{"verdict":"safe","reason":"read"}')).toEqual({ outcome: 'safe', reason: 'read' });
    expect(parseTriage('{"verdict":"unsafe","reason":"writes"}')).toEqual({ outcome: 'unsafe', reason: 'writes' });
    expect(parseTriage('{"verdict":"escalate","reason":"scoped edit"}')).toEqual({
      outcome: 'escalate',
      reason: 'scoped edit'
    });
  });
  it('is case/prose tolerant', () => {
    expect(parseTriage('```json\n{"verdict":"ESCALATE"}\n```')?.outcome).toBe('escalate');
  });
  it('maps a legacy {"safe":bool} reply (no escalate)', () => {
    expect(parseTriage('{"safe":true}')).toEqual({ outcome: 'safe', reason: '' });
    expect(parseTriage('{"safe":false}')).toEqual({ outcome: 'unsafe', reason: '' });
  });
  it('rejects unparsable / unknown verdicts', () => {
    expect(parseTriage('{"verdict":"maybe"}')).toBeNull();
    expect(parseTriage('nope')).toBeNull();
    expect(parseTriage('')).toBeNull();
  });
});

describe('Overseer.decide — path-confinement tier', () => {
  const confineToRepo: OverseerDeps['confinePath'] = (t) => t.startsWith('/repo/');

  it('auto-approves a Write whose target confines inside cwd', async () => {
    const { o } = make({}, undefined, { confinePath: confineToRepo });
    const d = await o.decide(ev('Write', { file_path: '/repo/src/x.ts', content: 'hi' }));
    expect(d.verdict).toBe('allow');
    expect(d.tier).toBe('confine');
  });

  it('does NOT approve a Write that escapes the tree', async () => {
    const { o } = make({}, undefined, { confinePath: confineToRepo });
    const d = await o.decide(ev('Write', { file_path: '/etc/passwd', content: 'x' }));
    expect(d.verdict).toBe('ask');
    expect(d.tier).toBe('default');
  });

  it('guardrail still wins over a confined write (e.g. a .env inside cwd)', async () => {
    const { o } = make({}, undefined, { confinePath: confineToRepo });
    const d = await o.decide(ev('Write', { file_path: '/repo/.env', content: 'K=v' }));
    expect(d.tier).toBe('deny-guard');
    expect(d.verdict).toBe('ask');
  });

  it('a confinePath that throws never blocks — falls through to ask', async () => {
    const boom: OverseerDeps['confinePath'] = () => {
      throw new Error('realpath failed');
    };
    const { o } = make({}, undefined, { confinePath: boom });
    const d = await o.decide(ev('Write', { file_path: '/repo/x.ts', content: 'x' }));
    expect(d.verdict).toBe('ask');
    expect(d.tier).toBe('default');
  });

  it('is skipped entirely when no confinePath is injected', async () => {
    const { o } = make({}); // no confinePath dep
    const d = await o.decide(ev('Write', { file_path: '/repo/x.ts', content: 'x' }));
    expect(d.verdict).toBe('ask');
  });
});

describe('Overseer.decide — deep (think harder) tier', () => {
  it('escalates a fast "escalate" to the deep judge, which can auto-approve', async () => {
    const runJudge = vi.fn(async () => ok('{"verdict":"escalate","reason":"scoped edit"}'));
    const runJudgeDeep = vi.fn(async () => ok('{"safe":true,"reason":"stays in tree"}'));
    const { o } = make({ llmTierEnabled: true, deepTierEnabled: true }, runJudge, { runJudgeDeep });
    const d = await o.decide(ev('SomeTool', { x: 1 }));
    expect(runJudge).toHaveBeenCalledOnce();
    expect(runJudgeDeep).toHaveBeenCalledOnce();
    expect(d.verdict).toBe('allow');
    expect(d.tier).toBe('deep');
  });

  it('asks when the deep judge is not confident', async () => {
    const runJudge = vi.fn(async () => ok('{"verdict":"escalate"}'));
    const runJudgeDeep = vi.fn(async () => ok('{"safe":false,"reason":"reaches network"}'));
    const { o } = make({ llmTierEnabled: true, deepTierEnabled: true }, runJudge, { runJudgeDeep });
    expect((await o.decide(ev('SomeTool'))).verdict).toBe('ask');
  });

  it('does NOT call the deep judge when the deep tier is off (escalate → ask)', async () => {
    const runJudge = vi.fn(async () => ok('{"verdict":"escalate"}'));
    const runJudgeDeep = vi.fn(async () => ok('{"safe":true}'));
    const { o } = make({ llmTierEnabled: true, deepTierEnabled: false }, runJudge, { runJudgeDeep });
    const d = await o.decide(ev('SomeTool'));
    expect(d.verdict).toBe('ask');
    expect(runJudgeDeep).not.toHaveBeenCalled();
  });

  it('a confident fast "safe" auto-approves without ever escalating', async () => {
    const runJudge = vi.fn(async () => ok('{"verdict":"safe","reason":"read only"}'));
    const runJudgeDeep = vi.fn(async () => ok('{"safe":true}'));
    const { o } = make({ llmTierEnabled: true, deepTierEnabled: true }, runJudge, { runJudgeDeep });
    const d = await o.decide(ev('SomeTool'));
    expect(d.tier).toBe('llm');
    expect(d.verdict).toBe('allow');
    expect(runJudgeDeep).not.toHaveBeenCalled();
  });

  it('fails open (ask) when the deep judge call errors', async () => {
    const runJudge = vi.fn(async () => ok('{"verdict":"escalate"}'));
    const runJudgeDeep = vi.fn(async (): Promise<import('@zana-ai/zcc-domain/product').LlmRunResult> => ({
      ok: false,
      text: '',
      provider: 'claude-cli',
      ms: 0
    }));
    const { o } = make({ llmTierEnabled: true, deepTierEnabled: true }, runJudge, { runJudgeDeep });
    expect((await o.decide(ev('SomeTool'))).verdict).toBe('ask');
  });
});
