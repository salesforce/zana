import { describe, expect, it } from 'vitest';
import {
  activateArgs,
  agentCliOpts,
  agentEvalHelpAvailable,
  agentPluginAvailable,
  canActivate,
  compactPreviewDigest,
  diagnoseAgentBundle,
  EvalEvidenceStore,
  evalRunStatus,
  extractEvalBotVersionId,
  extractEvalRunId,
  extractSessionId,
  findAgentBundle,
  isEvalTerminal,
  parseAgentInput,
  parseEvalSpec,
  parseSfJson,
  previewArgs,
  probeAgentCapabilities,
  publishArgs,
  resolveAgentCompilerBin,
  runEvalArgs,
  scanAgentBundles,
  specFingerprint,
  summarizeEvalRun,
  validateArgs
} from '../lib/agent.js';
import type { SalesforceDeps } from '../lib/types.js';

function memFs(files: Record<string, string>, dirs: Record<string, string[]>): SalesforceDeps {
  return {
    execSf: async () => ({ code: 1, stdout: '', stderr: 'unexpected' }),
    request: async () => ({ status: 500, json: null, text: '' }),
    now: () => 1,
    exists: (path) => path in files || path in dirs,
    stat: (path) => (path in dirs ? 'dir' : path in files ? 'file' : 'missing'),
    readFile: (path) => files[path] ?? null,
    readdir: (path) => dirs[path] ?? [],
    realpath: (path) => path,
    spawnContained: async () => ({ code: 0, stdout: 'ok', stderr: '' })
  };
}

const agentFs = memFs(
  {
    '/proj/sfdx-project.json': '{"packageDirectories":[{"path":"force-app"}]}',
    '/proj/force-app/MyBot.agent': 'config {\n  name: "MyBot"\n}\nstart_agent {\n}\n',
    '/proj/force-app/Empty.agent': '',
    '/proj/orphan.agent': 'config {}\nstart_agent {}\n',
    '/proj/node_modules/.bin/agent-script': '#!/usr/bin/env node'
  },
  {
    '/proj': ['sfdx-project.json', 'force-app', 'orphan.agent', 'node_modules'],
    '/proj/force-app': ['MyBot.agent', 'Empty.agent'],
    '/proj/node_modules': ['.bin'],
    '/proj/node_modules/.bin': ['agent-script']
  }
);

describe('sf_agent parse and inspect', () => {
  it('rejects unknown actions and missing required fields', () => {
    expect(parseAgentInput({ action: 'mutate' }).ok).toBe(false);
    expect(parseAgentInput({ action: 'compile' }).ok).toBe(false);
    expect(parseAgentInput({ action: 'preview.send', sessionId: 's' }).ok).toBe(false);
    expect(parseAgentInput({ action: 'preview.end' }).ok).toBe(false);
    expect(parseAgentInput({ action: 'eval.run' }).ok).toBe(false);
    expect(parseAgentInput({ action: 'lifecycle.activate' }).ok).toBe(false);
    expect(parseAgentInput({ action: 'compile', apiName: 'MyBot' }).ok).toBe(true);
    expect(parseAgentInput({ action: 'inspect' }).ok).toBe(true);
    expect(parseAgentInput({ action: 'lifecycle.list' }).ok).toBe(true);
    expect(parseAgentInput({ action: 'preview.start', path: 'force-app/MyBot.agent' }).ok).toBe(true);
    expect(parseAgentInput({ action: 'eval.run', specPath: 'evals/spec.json' }).ok).toBe(true);
    expect(parseAgentInput({ action: 'eval.run', aiEvaluationDefinitionName: 'My_Eval' }).ok).toBe(true);
    expect(parseAgentInput({ action: 'preview.start', apiName: 'Published', published: true })).toMatchObject({
      ok: true,
      plan: { published: true }
    });
    expect(parseAgentInput({ action: 'lifecycle.activate', botVersionId: 'bv-1', allow_untested: true })).toMatchObject({
      ok: true,
      plan: { allowUntested: true }
    });
  });

  it('scans only confined package-directory .agent files', () => {
    const bundles = scanAgentBundles('/proj', agentFs);
    expect(bundles.map((row) => row.apiName).sort()).toEqual(['Empty', 'MyBot']);
    expect(findAgentBundle(bundles, 'MyBot')?.hasStartAgent).toBe(true);
    expect(findAgentBundle(bundles, undefined, 'force-app/Empty.agent')?.apiName).toBe('Empty');
    expect(findAgentBundle(bundles, 'Missing')).toBeNull();
    expect(findAgentBundle(bundles)).toBeNull();
    expect(diagnoseAgentBundle(findAgentBundle(bundles, 'MyBot')!)).toEqual([]);
    expect(diagnoseAgentBundle(findAgentBundle(bundles, 'Empty')!)).toEqual(
      expect.arrayContaining(['Missing config block.', 'Missing start_agent or orchestrator entry.', 'Agent Script file looks empty.'])
    );
  });

  it('resolves the official compiler bin under the DX project', () => {
    expect(resolveAgentCompilerBin('/proj', agentFs)).toBe('/proj/node_modules/.bin/agent-script');
    expect(resolveAgentCompilerBin('/proj', memFs({}, {}))).toBeNull();
  });
});

describe('sf_agent compile probes and CLI parsing', () => {
  it('reports a missing compiler when neither the library nor sf agent is present', async () => {
    const deps: SalesforceDeps = {
      ...agentFs,
      execSf: async () => ({ code: 1, stdout: '', stderr: ' ›   Error: Command agent not found.' })
    };
    await expect(probeAgentCapabilities('/empty', deps)).resolves.toEqual({ compiler: 'missing', pluginOk: false });
    expect(agentPluginAvailable({ code: 127, stdout: '', stderr: '' })).toBe(false);
    expect(agentPluginAvailable({ code: 1, stdout: '', stderr: 'is not a sf command' })).toBe(false);
    expect(agentPluginAvailable({ code: 0, stdout: 'USAGE\n  $ sf agent validate\n', stderr: '' })).toBe(true);
  });

  it('prefers the library compiler and still reports plugin availability', async () => {
    const deps: SalesforceDeps = {
      ...agentFs,
      execSf: async (args) => {
        if (args[0] === 'agent' && args[1] === '--help') {
          return { code: 0, stdout: 'validate preview publish activate\n', stderr: '' };
        }
        return { code: 1, stdout: '', stderr: 'unexpected' };
      }
    };
    await expect(probeAgentCapabilities('/proj', deps)).resolves.toEqual({ compiler: 'library', pluginOk: true });
  });

  it('falls back to the sf agent CLI when the library bin is absent', async () => {
    const deps: SalesforceDeps = {
      ...memFs({}, {}),
      execSf: async () => ({ code: 0, stdout: 'preview publish activate validate\n', stderr: '' })
    };
    await expect(probeAgentCapabilities('/proj', deps)).resolves.toEqual({ compiler: 'cli', pluginOk: true });
  });

  it('parses sf JSON, preview digests, and eval specs', () => {
    expect(parseSfJson('not json').status).toBe(1);
    expect(parseSfJson(JSON.stringify({ status: 0, result: { id: '1' } }))).toMatchObject({
      status: 0,
      result: { id: '1' }
    });
    expect(extractSessionId({ result: { sessionId: 'sess-9' } })).toBe('sess-9');
    expect(extractSessionId(null)).toBeNull();
    expect(compactPreviewDigest({ message: 'from-message' }).response).toBe('from-message');
    expect(compactPreviewDigest({ agentResponse: 'from-agent' }).response).toBe('from-agent');
    expect(extractSessionId({ session_id: 's2' })).toBe('s2');
    expect(extractSessionId({ id: 'id-9' })).toBe('id-9');
    expect(parseSfJson(JSON.stringify({ name: 'ErrorName', result: null })).message).toBe('ErrorName');
    expect(summarizeEvalRun({ passCount: 2, failCount: 1 }, 3)).toEqual({
      passed: false,
      passedCount: 2,
      failedCount: 1
    });
    expect(summarizeEvalRun(null, 2)).toEqual({ passed: false, passedCount: 0, failedCount: 2 });
    expect(parseEvalSpec('[]').ok).toBe(false);
    expect(parseEvalSpec('{').ok).toBe(false);
    expect(parseEvalSpec(JSON.stringify({ tests: [{ utterance: 'hi' }] }))).toMatchObject({ ok: true, testCount: 1 });
    expect(parseEvalSpec(JSON.stringify({ utterances: ['a', 'b'] }))).toMatchObject({ ok: true, testCount: 2 });
    expect(summarizeEvalRun({ success: true }, 3)).toEqual({ passed: true, passedCount: 3, failedCount: 0 });
    expect(summarizeEvalRun({ passedCount: 1, failedCount: 1 }, 2)).toEqual({
      passed: false,
      passedCount: 1,
      failedCount: 1
    });
    expect(specFingerprint('{"tests":[]}').length).toBe(12);
    expect(validateArgs('MyBot', 'dev')).toEqual([
      'agent',
      'validate',
      'authoring-bundle',
      '--json',
      '--api-name',
      'MyBot',
      '--target-org',
      'dev'
    ]);
    expect(
      previewArgs('send', { sessionId: 'sess-1', utterance: 'hi' }, 'dev', {
        flag: 'authoring-bundle',
        apiName: 'MyBot'
      })
    ).toEqual([
      'agent',
      'preview',
      'send',
      '--json',
      '--target-org',
      'dev',
      '--authoring-bundle',
      'MyBot',
      '--session-id',
      'sess-1',
      '--utterance',
      'hi'
    ]);
    expect(publishArgs('MyBot', 'dev')).toEqual(
      expect.arrayContaining(['authoring-bundle', '--skip-retrieve', '--target-org', 'dev'])
    );
    expect(activateArgs('MyBot', 'dev', 2)).toEqual([
      'agent',
      'activate',
      '--json',
      '--api-name',
      'MyBot',
      '--target-org',
      'dev',
      '--version',
      '2'
    ]);
    expect(parseAgentInput({ action: 'lifecycle.activate', apiName: 'MyBot', versionNumber: 3 })).toMatchObject({
      ok: true,
      plan: { versionNumber: 3 }
    });
    expect(
      previewArgs('start', {}, 'dev', { flag: 'authoring-bundle', apiName: 'MyBot' })
    ).toEqual([
      'agent',
      'preview',
      'start',
      '--json',
      '--target-org',
      'dev',
      '--authoring-bundle',
      'MyBot',
      '--simulate-actions'
    ]);
    expect(previewArgs('start', {}, 'dev', { flag: 'api-name', apiName: 'PublishedBot' })).toEqual([
      'agent',
      'preview',
      'start',
      '--json',
      '--target-org',
      'dev',
      '--api-name',
      'PublishedBot'
    ]);
    expect(previewArgs('start', {}, 'dev', { flag: 'api-name', apiName: 'PublishedBot' })).not.toContain(
      '--simulate-actions'
    );
    expect(runEvalArgs('/proj/evals/spec.yaml', 'dev')).toEqual([
      'agent',
      'test',
      'run-eval',
      '--spec',
      '/proj/evals/spec.yaml',
      '--json',
      '--target-org',
      'dev'
    ]);
    expect(agentCliOpts('/proj')).toEqual({ cwd: '/proj', timeoutMs: 120_000 });
    expect(extractEvalRunId({ id: 'run-9' })).toBe('run-9');
    expect(extractEvalRunId({ result: { runId: 'run-2' } })).toBe('run-2');
    expect(extractEvalRunId({})).toBeNull();
    expect(evalRunStatus({ status: 'IN_PROGRESS' })).toBe('IN_PROGRESS');
    expect(isEvalTerminal('COMPLETED')).toBe(true);
    expect(isEvalTerminal('IN_PROGRESS')).toBe(false);
    expect(extractEvalBotVersionId({ subjectName: 'MyBot' })).toBe('MyBot');
    expect(extractEvalBotVersionId({ versionNumber: 4 })).toBe('4');
    expect(extractEvalBotVersionId({ version: 'v3' })).toBe('v3');
    expect(extractEvalBotVersionId({}, 'fallback')).toBe('fallback');
    expect(agentEvalHelpAvailable({ code: 0, stdout: 'USAGE\n  $ sf agent test run-eval\n', stderr: '' })).toBe(true);
    expect(agentEvalHelpAvailable({ code: 1, stdout: '', stderr: 'Command test:run-eval not found' })).toBe(false);
  });
});

describe('sf_agent activation gate', () => {
  it('blocks activate without matching passing eval evidence', () => {
    expect(
      canActivate({ evidence: null, orgId: '00D', botVersionId: 'bv-1', allowUntested: false })
    ).toMatchObject({ ok: false, code: 'eval_required' });
    expect(
      canActivate({
        evidence: { orgId: 'other', botVersionId: 'bv-1', specFingerprint: 'abc', passed: true, at: 1 },
        orgId: '00D',
        botVersionId: 'bv-1',
        allowUntested: false
      })
    ).toMatchObject({ ok: false, code: 'eval_required' });
    expect(
      canActivate({
        evidence: { orgId: '00D', botVersionId: 'bv-1', specFingerprint: 'abc', passed: false, at: 1 },
        orgId: '00D',
        botVersionId: 'bv-1',
        allowUntested: false
      })
    ).toMatchObject({ ok: false, code: 'eval_required' });
  });

  it('allows activate with passing evidence, or untested intent as a flag only', async () => {
    const evidence = { orgId: '00D', botVersionId: 'bv-1', specFingerprint: 'abc', passed: true, at: 1 };
    expect(canActivate({ evidence, orgId: '00D', botVersionId: 'bv-1', allowUntested: false })).toEqual({
      ok: true,
      untested: false
    });
    expect(
      canActivate({ evidence: null, orgId: '00D', botVersionId: 'bv-1', allowUntested: true })
    ).toEqual({ ok: true, untested: true });
    const kv = new Map<string, unknown>();
    const store = new EvalEvidenceStore({
      get: async (key) => kv.get(key) as never,
      set: async (key, value) => {
        kv.set(key, value);
      }
    });
    await store.record(evidence);
    expect(await store.get('00D', 'bv-1')).toEqual(evidence);
    expect(await store.get('00D', 'missing')).toBeNull();
    const reloaded = new EvalEvidenceStore({
      get: async (key) => kv.get(key) as never,
      set: async (key, value) => {
        kv.set(key, value);
      }
    });
    expect(await reloaded.get('00D', 'bv-1')).toEqual(evidence);
  });
});
