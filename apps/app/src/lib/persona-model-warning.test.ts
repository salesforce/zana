import { describe, expect, it } from 'vitest';
import { unknownPersonaModels } from './persona-model-warning.js';

const entry = (ids: string[], over: Record<string, unknown> = {}) => ({ models: ids.map((id) => ({ id, model: id, displayName: id })), selectedOnlyModels: [], modelLoadError: null, ...over });
const catalog = (byProvider: Record<string, unknown>, provisional: string[] = []) =>
  ({ byProvider, provisionalProviders: new Set(provisional) }) as never;
const persona = (model: string | undefined, baseProfile: string | null = 'pi') =>
  ({ id: 'p', name: 'P', model, baseProfile: baseProfile ?? undefined }) as never;

describe('unknownPersonaModels', () => {
  const cat = catalog({ pi: entry(['anthropic/claude-x', 'openai/gpt-y']), 'acp-opencode': entry(['a/b']), 'claude-code': entry(['opus']) });

  it('flags a model the loaded catalog does not list', () => {
    expect(unknownPersonaModels([persona('nope')], cat)).toEqual([{ personaId: 'p', personaName: 'P', model: 'nope' }]);
  });
  it('accepts exact ids and pattern fragments', () => {
    expect(unknownPersonaModels([persona('openai/gpt-y')], cat)).toEqual([]);
    expect(unknownPersonaModels([persona('GPT-Y')], cat)).toEqual([]);
  });
  it('skips providers that accept unlisted targets', () => {
    expect(unknownPersonaModels([persona('nope', 'claude')], cat)).toEqual([]);
  });
  it.each([[undefined], ['default'], [' ']])('skips model %j', (m) => {
    expect(unknownPersonaModels([persona(m)], cat)).toEqual([]);
  });
  it('skips personas without a pinned harness', () => {
    expect(unknownPersonaModels([persona('nope', null)], cat)).toEqual([]);
  });
  it('skips a profile with no harness family', () => {
    expect(unknownPersonaModels([persona('nope', 'shell')], cat)).toEqual([]);
  });
  it('gives no warning when the catalog cannot answer', () => {
    expect(unknownPersonaModels([persona('nope')], catalog({}))).toEqual([]);
    expect(unknownPersonaModels([persona('nope')], catalog({ pi: entry([]) }))).toEqual([]);
    expect(unknownPersonaModels([persona('nope')], catalog({ pi: entry(['a'], { modelLoadError: 'failed' }) }))).toEqual([]);
    expect(unknownPersonaModels([persona('nope')], catalog({ pi: entry(['a']) }, ['pi']))).toEqual([]);
  });
});
