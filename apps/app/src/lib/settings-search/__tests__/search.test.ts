import { describe, expect, it, vi } from 'vitest';
import { typoDistance, typoMaxEdits } from '@zana-ai/zcc-fuzzy-match';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { buildCorpus, fold, normalize } from '../corpus';
import { searchSettings } from '../index';
import { SETTINGS_SEARCH_MAX_RESULTS, mergeRanges } from '../match';
import { collectEntryModules, deriveNavEntries, getStaticEntries, getSettingsSearchProviders, notifySettingsSearchSourcesChanged, registerSettingsSearchProvider } from '../registry';
import { findSecretValueViolations, mayIndexValue } from '../secrets';
import type { SettingsSearchEntry, SettingsSearchProvider, SettingsValueSnapshot } from '../types';

const snap = (config: Record<string, unknown> = {}): SettingsValueSnapshot => ({ config: config as unknown as AppConfig });
const e = (id: string, label: string, extra: Partial<SettingsSearchEntry> = {}): SettingsSearchEntry => ({
  id, section: 'terminal', label, kind: 'setting', ...extra
});
const ids = (hits: { entry: { id: string } }[]) => hits.map((h) => h.entry.id);

describe('typoDistance', () => {
  it('counts swaps as one edit', () => {
    expect(typoDistance('tmxu', 'tmux')).toBe(1);
    expect(typoDistance('heartbaet', 'heartbeat')).toBe(1);
  });
  it('handles equal, empty and early cutoff', () => {
    expect(typoDistance('abc', 'abc')).toBe(0);
    expect(typoDistance('', 'abc')).toBe(3);
    expect(typoDistance('abc', '')).toBe(3);
    expect(typoDistance('kitten', 'sitting')).toBe(3);
    expect(typoDistance('kitten', 'sitting', 1)).toBe(2);
    expect(typoDistance('aaaa', 'zzzzzz', 1)).toBe(2);
    expect(typoDistance('abcdef', 'uvwxyz', 2)).toBe(3);
  });
  it('budgets edits by word length', () => {
    expect([3, 4, 7, 8, 12].map(typoMaxEdits)).toEqual([0, 1, 1, 2, 2]);
  });
});

describe('normalisation', () => {
  it('strips diacritics 1:1 and lowercases', () => {
    expect(fold('Café Ünï')).toBe('cafe uni');
    expect(fold('Café').length).toBe(4);
    expect(normalize('  Hello\n  WORLD ')).toBe('hello world');
    expect(fold('é')).toBe('é'.length === 2 ? 'é' : 'e');
  });
});

describe('Squad idle timeout value', () => {
  it('is the 45-minute default for unset, null or non-numeric configs, never NaN', async () => {
    const { entries } = await import('../entries/agents');
    const value = entries.find((x) => x.id === 'agents.squad-idle-timeout')!.value!;
    const at = (autonomousTimeoutMs: unknown) => value(snap({ autonomousTimeoutMs }));
    expect(at(0)).toBe('0');
    expect(at(30 * 60 * 1000)).toBe('30');
    for (const odd of [undefined, null, Number.NaN, 'soon']) expect(at(odd)).toBe('45');
  });
});

describe('decomposed diacritics (NFD input) through the matching path', () => {
  it('matches precomposed and decomposed forms in both directions', () => {
    const composed = 'Caf\u00e9 mode';
    const decomposed = 'Cafe\u0301 mode';
    expect(normalize(composed)).toBe('cafe mode');
    expect(normalize(decomposed)).toBe('cafe mode');
    // query decomposed -> entry precomposed, and the reverse, and plain ASCII to both
    expect(ids(searchSettings('cafe\u0301', snap(), { entries: [e('a', composed)] }))).toEqual(['a']);
    expect(ids(searchSettings('caf\u00e9', snap(), { entries: [e('b', decomposed)] }))).toEqual(['b']);
    expect(ids(searchSettings('cafe', snap(), { entries: [e('a', composed), e('b', decomposed)] })).sort()).toEqual(['a', 'b']);
  });
});

describe('non-Latin folding', () => {
  it('keeps Hangul syllables intact (a decomposition into further letters is not a diacritic)', () => {
    expect(fold('\uD55C\uAD6D')).toBe('\uD55C\uAD6D');
    expect(fold('\uD55C\uAD6D').length).toBe(2);
    // Before the fix each syllable folded to its first jamo, so unrelated names collided.
    const hits = searchSettings('\uD55C\uAD6D', snap(), { entries: [e('a', '\uD55C\uAD6D server'), e('b', '\uD558\uB298')] });
    expect(ids(hits)).toEqual(['a']);
  });
});

describe('tiers', () => {
  const entries = [
    e('help-only', 'Unrelated', { help: 'Some words about tmux sessions here.' }),
    e('fuzzy-label', 'Terminal multiplexer unit', { help: 'x' }),
    e('typo', 'Zzz', { help: 'uses tmxu internally' })
  ];
  it('tier-1 hit outranks tier-2 and tier-3 hits', () => {
    const hits = searchSettings('tmux', snap(), { entries: [
      e('t3', 'Tmxu thing'),
      e('t2', 'Terminal multiplexer unit x'),
      e('t1', 'Zzz', { help: 'uses tmux inside' })
    ] });
    expect(ids(hits)).toEqual(['t1', 't2', 't3']);
    expect(hits.map((h) => h.tier)).toEqual([1, 2, 3]);
  });
  it('tier-2 matches letters in order on label but not help', () => {
    expect(ids(searchSettings('autcls', snap(), { entries: [e('a', 'Auto-close idle')] }))).toEqual(['a']);
    expect(searchSettings('autcls', snap(), { entries: [e('a', 'Nope', { help: 'Auto-close idle' })] })).toEqual([]);
    void entries;
  });
  it('typos: tmxu finds tmux, heartbaet finds heartbeat', () => {
    const list = [e('tmux', 'tmux'), e('hb', 'Agent heartbeat'), e('other', 'Other')];
    expect(ids(searchSettings('tmxu', snap(), { entries: list }))).toContain('tmux');
    expect(ids(searchSettings('heartbaet', snap(), { entries: list }))).toEqual(['hb']);
  });
  it('no typo tolerance under 4 characters', () => {
    expect(searchSettings('tmx', snap(), { entries: [e('x', 'xmt')] })).toEqual([]);
    expect(searchSettings('xmt', snap(), { entries: [e('x', 'tmx')] })).toEqual([]);
  });
  it('allows 2 edits for 8+ char words', () => {
    expect(ids(searchSettings('heartbaat', snap(), { entries: [e('h', 'heartbeat')] }))).toEqual(['h']);
    expect(ids(searchSettings('heartbaats', snap(), { entries: [e('h', 'heartbeat')] }))).toEqual(['h']);
  });
  it('label exact > prefix > substring', () => {
    const hits = searchSettings('theme', snap(), { entries: [
      e('sub', 'Dark theme'), e('pre', 'Theme picker'), e('ex', 'Theme')
    ] });
    expect(ids(hits)).toEqual(['ex', 'pre', 'sub']);
  });
});

describe('AND matching and diacritics', () => {
  it('requires every word, across fields', () => {
    const list = [e('a', 'Idle timeout', { help: 'Close agents' }), e('b', 'Idle only')];
    expect(ids(searchSettings('idle close', snap(), { entries: list }))).toEqual(['a']);
    expect(searchSettings('idle zebra', snap(), { entries: list })).toEqual([]);
  });
  it('ignores diacritics both ways', () => {
    const list = [e('c', 'Café mode'), e('d', 'Plain', { keywords: ['naïve'] })];
    expect(ids(searchSettings('cafe', snap(), { entries: list }))).toEqual(['c']);
    expect(ids(searchSettings('CAFÉ', snap(), { entries: list }))).toEqual(['c']);
    expect(ids(searchSettings('naive', snap(), { entries: list }))).toEqual(['d']);
  });
  it('empty, blank and oversize queries return nothing', () => {
    const list = [e('a', 'Idle')];
    expect(searchSettings('', snap(), { entries: list })).toEqual([]);
    expect(searchSettings('   ', snap(), { entries: list })).toEqual([]);
    expect(searchSettings('a'.repeat(300), snap(), { entries: list })).toEqual([]);
    expect(searchSettings('idle', snap(), { entries: list, limit: 0 })).toEqual([]);
  });
});

describe('snippets, cap and ordering', () => {
  it('merges overlapping highlight ranges so no text renders twice', () => {
    expect(mergeRanges([[4, 8], [0, 4], [0, 9], [12, 14]])).toEqual([[0, 9], [12, 14]]);
    const [hit] = searchSettings('auto automatic', snap(), {
      entries: [e('a', 'Zzz', { help: 'Closes agents automatically when idle.' })]
    });
    const { text, ranges } = hit.snippet!;
    expect(ranges).toHaveLength(1);
    expect(text.slice(ranges[0][0], ranges[0][1]).toLowerCase()).toBe('automatic');
  });

  it('builds a windowed snippet with ranges', () => {
    const help = `${'lorem ipsum '.repeat(10)}the heartbeat interval controls pings ${'dolor sit '.repeat(10)}`;
    const [hit] = searchSettings('heartbeat', snap(), { entries: [e('a', 'Zzz', { help })] });
    expect(hit.snippet).toBeDefined();
    const { text, ranges } = hit.snippet!;
    expect(text.startsWith('…') && text.endsWith('…')).toBe(true);
    expect(ranges).toHaveLength(1);
    expect(text.slice(ranges[0][0], ranges[0][1])).toBe('heartbeat');
  });
  it('snippet highlights a typo hit and preserves original case', () => {
    const [hit] = searchSettings('heartbaet', snap(), { entries: [e('a', 'Zzz', { help: 'The Heartbeat pings.' })] });
    expect(hit.snippet!.text.slice(...hit.snippet!.ranges[0])).toBe('Heartbeat');
  });
  it('no snippet without a help hit', () => {
    const [hit] = searchSettings('zzz', snap(), { entries: [e('a', 'Zzz', { help: 'unrelated' })] });
    expect(hit.snippet).toBeUndefined();
  });
  it('caps at 60 and honours a smaller limit', () => {
    const many = Array.from({ length: 200 }, (_, i) => e(`id${i}`, `Widget ${i}`));
    expect(searchSettings('widget', snap(), { entries: many })).toHaveLength(SETTINGS_SEARCH_MAX_RESULTS);
    expect(searchSettings('widget', snap(), { entries: many, limit: 500 })).toHaveLength(SETTINGS_SEARCH_MAX_RESULTS);
    expect(searchSettings('widget', snap(), { entries: many, limit: 5 })).toHaveLength(5);
  });
  it('ties break stably by settings order, not input shuffle', () => {
    const list = [
      e('late', 'Widget', { section: 'about' }),
      e('early', 'Widget', { section: 'global' }),
      e('early2', 'Widget', { section: 'global' })
    ];
    const first = ids(searchSettings('widget', snap(), { entries: list }));
    expect(first).toEqual(['early', 'early2', 'late']);
    expect(ids(searchSettings('widget', snap(), { entries: list }))).toEqual(first);
  });
  it('dedupes ids and uses breadcrumbs with subsection labels', () => {
    const list = [e('a', 'Shell path', { section: 'terminal', anchor: 'terminal-shell' }), e('a', 'dup')];
    const hits = searchSettings('shell', snap(), { entries: list });
    expect(hits).toHaveLength(1);
    expect(hits[0].breadcrumb).toBe('Terminal › Shell');
  });
  it('matches breadcrumb text, project and unknown sections', () => {
    const list = [e('p', 'Anything', { section: 'project' }), e('u', 'Other', { section: 'mod-x' })];
    expect(ids(searchSettings('project', snap(), { entries: list }))).toEqual(['p']);
    expect(searchSettings('other', snap(), { entries: list })[0].breadcrumb).toBe('mod-x');
  });
});

describe('values', () => {
  const theme = e('theme', 'Theme', { value: (s) => String((s.config as unknown as { theme?: string }).theme) });
  it('finds a field by its current value and shows it', () => {
    const [hit] = searchSettings('dark', snap({ theme: 'Dark' }), { entries: [theme] });
    expect(hit.entry.id).toBe('theme');
    expect(hit.matchedValue).toBe('Dark');
  });
  it('re-derives values only when snapshot identity changes', () => {
    const value = vi.fn((s: SettingsValueSnapshot) => String((s.config as unknown as { v: string }).v));
    const entry = e('x', 'Thing', { value });
    const entries = [entry];
    const a = snap({ v: 'alpha' });
    searchSettings('thing', a, { entries });
    searchSettings('alpha', a, { entries });
    expect(value).toHaveBeenCalledTimes(1);
    expect(searchSettings('beta', snap({ v: 'beta' }), { entries })).toHaveLength(1);
    expect(value).toHaveBeenCalledTimes(2);
    expect(buildCorpus(a, entries)).not.toBe(buildCorpus(snap({ v: 'alpha' }), entries));
  });
  it('rebuilds when a provider signals new data, even with the same snapshot and provider set', () => {
    let rows: SettingsSearchEntry[] = [];
    const none: SettingsSearchEntry[] = []; // stable identity: the cache keys on it
    const off = registerSettingsSearchProvider(() => rows);
    try {
      const same = snap();
      expect(searchSettings('harness late', same, { entries: none })).toEqual([]);
      rows = [e('late', 'Harness late row')];
      // Without a signal the memoised corpus is reused (stale by design)...
      expect(buildCorpus(same, none)).toBe(buildCorpus(same, none));
      expect(ids(searchSettings('harness late', same, { entries: none }))).toEqual([]);
      notifySettingsSearchSourcesChanged();
      // ...and the signal makes the next search see the new rows.
      expect(ids(searchSettings('harness late', same, { entries: none }))).toEqual(['late']);
    } finally {
      off();
    }
  });
  it('supports array values, truncates long ones and swallows accessor errors', () => {
    const list = [
      e('arr', 'A', { value: () => ['one', 'two'] }),
      e('long', 'L', { value: () => `${'x'.repeat(250)}needle` }),
      e('boom', 'Boom', { value: () => { throw new Error('x'); } }),
      e('none', 'None', { value: () => undefined }),
      e('blank', 'Blank', { value: () => '  ' })
    ];
    expect(ids(searchSettings('two', snap(), { entries: list }))).toEqual(['arr']);
    expect(searchSettings('needle', snap(), { entries: list })).toEqual([]);
    const [hit] = searchSettings('xxxxx', snap(), { entries: list });
    expect(hit.matchedValue!.length).toBeLessThanOrEqual(80);
    expect(ids(searchSettings('boom', snap(), { entries: list }))).toEqual(['boom']);
  });
  it('finds values by typo (tier 3) but not by letters-in-order', () => {
    const list = [e('b', 'Binary', { value: () => '/opt/homebrew/bin/claude' })];
    expect(ids(searchSettings('homebrw', snap(), { entries: list }))).toEqual(['b']);
    expect(searchSettings('hmbrw', snap(), { entries: list })).toEqual([]);
  });
});

describe('secret denylist', () => {
  it('never reads values from secret-looking entries', () => {
    const accessor = vi.fn(() => 'hunter2-supersecret');
    const list = [
      e('auth.token', 'Access thing', { value: accessor }),
      e('x', 'API key', { value: accessor }),
      e('y', 'Cookie jar', { value: accessor })
    ];
    expect(searchSettings('hunter2', snap(), { entries: list })).toEqual([]);
    expect(accessor).not.toHaveBeenCalled();
    expect(findSecretValueViolations(list).sort()).toEqual(['auth.token', 'x', 'y']);
    expect(mayIndexValue(e('ok', 'Shell', { value: () => 'zsh' }))).toBe(true);
    expect(mayIndexValue(e('ok2', 'Shell'))).toBe(false);
  });
  it('also denies one-time codes and credential-carrying URLs/strings by name', () => {
    const accessor = vi.fn(() => 'leak');
    const risky = [
      e('remote-access.connect-code', 'Get a connect code', { value: accessor }),
      e('machines.pairing-code', 'Pairing code', { value: accessor }),
      e('x.join', 'Join code', { value: accessor }),
      e('hooks.url', 'Webhook URL', { value: accessor }),
      e('db', 'Connection string', { value: accessor }),
      e('sentry', 'Sentry DSN', { value: accessor })
    ];
    expect(findSecretValueViolations(risky)).toHaveLength(risky.length);
    expect(searchSettings('leak', snap(), { entries: risky })).toEqual([]);
    expect(accessor).not.toHaveBeenCalled();
    // Words that merely contain the letters stay indexable.
    expect(mayIndexValue(e('editor.encoder', 'Encoder', { value: () => 'x' }))).toBe(true);
  });
  it('does not treat Object.prototype keys as allowlisted and checks the anchor', () => {
    const accessor = vi.fn(() => 'leak');
    const list = [e('constructor.token', 'Thing', { value: accessor }), e('toString', 'Auth', { value: accessor }), e('p', 'Plain', { anchor: 'api-key', value: accessor })];
    expect(findSecretValueViolations(list)).toEqual(['constructor.token', 'toString', 'p']);
    expect(searchSettings('leak', snap(), { entries: list })).toEqual([]);
    expect(accessor).not.toHaveBeenCalled();
  });
  it('shipped static entries and provider output have no violations', () => {
    expect(findSecretValueViolations(getStaticEntries())).toEqual([]);
    const fixture: SettingsSearchProvider = () => [e('pl.ok', 'Port', { value: () => '8780' })];
    expect(findSecretValueViolations(fixture(snap()))).toEqual([]);
  });
});

describe('limit handling', () => {
  it('treats NaN as the default cap and negatives as zero', () => {
    const list = Array.from({ length: 5 }, (_, i) => e(`t.${i}`, `Terminal ${i}`));
    expect(searchSettings('terminal', snap(), { entries: list, limit: Number.NaN })).toHaveLength(5);
    expect(searchSettings('terminal', snap(), { entries: list, limit: -3 })).toEqual([]);
    expect(searchSettings('terminal', snap(), { entries: list, limit: 2.9 })).toHaveLength(2);
  });
});

describe('typoDistance edges', () => {
  it('handles repeated-transposition and cutoff boundary', () => {
    expect(typoDistance('abcd', 'badc', 5)).toBe(2);
    expect(typoDistance('abcd', 'badc', 1)).toBe(2);
    expect(typoDistance('kitten', 'sitting', 2)).toBe(3);
    expect(typoDistance('', 'abc', 5)).toBe(3);
  });
});

describe('registry', () => {
  it('derives section and subsection entries from the nav registry', () => {
    const derived = deriveNavEntries();
    expect(derived.find((d) => d.id === 'terminal.section')?.kind).toBe('section');
    expect(derived.find((d) => d.id === 'terminal.terminal-tmux')).toMatchObject({ kind: 'subsection', anchor: 'terminal-tmux', label: 'tmux' });
    expect(getStaticEntries()).toBe(getStaticEntries());
    expect(ids(searchSettings('heartbeat', snap()))).toContain('agents.agent-heartbeat.intro');
    expect(ids(searchSettings('tmxu', snap()))).toContain('terminal.tmux-persistence');
    expect(searchSettings('configuration', snap())[0].breadcrumb).toBeTruthy();
  });
  it('collects page modules in path order from default or named exports', () => {
    const a = e('a', 'A');
    const b = e('b', 'B');
    expect(collectEntryModules({ './entries/z.ts': { default: [b] }, './entries/a.ts': { entries: [a] }, './entries/n.ts': {} }).map((x) => x.id)).toEqual(['a', 'b']);
  });
  it('registers and unregisters runtime providers, tolerating throwing ones', () => {
    const before = getSettingsSearchProviders();
    const good: SettingsSearchProvider = () => [e('rt.gadget', 'Runtime gadget', { section: 'keyboard' }), e('rt.gadget', 'dup')];
    const bad: SettingsSearchProvider = () => { throw new Error('nope'); };
    const offBad = registerSettingsSearchProvider(bad);
    const off = registerSettingsSearchProvider(good);
    const s = snap();
    expect(ids(searchSettings('gadget', s))).toEqual(['rt.gadget']);
    off();
    offBad();
    expect(getSettingsSearchProviders()).toEqual(before);
    expect(searchSettings('gadget', snap())).toEqual([]);
  });
});

// Design budget: 8 ms per keystroke (median). Shared CI runners are noisy and
// throttled, so there the bound is a regression tripwire (an order-of-magnitude
// slowdown), not the budget itself; run locally to check the real budget.
const SEARCH_MEDIAN_BUDGET_MS = process.env.CI ? 40 : 8;

describe('performance', () => {
  it(`median query over 3000 synthetic entries is under the budget (${SEARCH_MEDIAN_BUDGET_MS} ms)`, () => {
    const vocab = ['agent', 'heartbeat', 'terminal', 'shell', 'tmux', 'editor', 'binary', 'timeout', 'idle', 'close', 'theme', 'launch', 'model', 'harness', 'prompt', 'inbox', 'browser', 'cookie', 'remote', 'machine'];
    const w = (i: number, n: number) => Array.from({ length: n }, (_, k) => vocab[(i * 7 + k * 3) % vocab.length] + (k % 5 === 0 ? i % 97 : '')).join(' ');
    const entries = Array.from({ length: 3000 }, (_, i) =>
      e(`syn.${i}`, w(i, 3), { section: i % 2 ? 'agents' : 'terminal', help: w(i + 1, 25), keywords: [w(i, 2)], options: [w(i, 1), w(i + 2, 1)], value: () => w(i, 2) })
    );
    const s = snap();
    searchSettings('warmup', s, { entries });
    const queries = ['tmux', 'heartbaet', 'agent idle', 'autcls', 'zzzzzz', 'binary timeout close', 'cookie', 'ed'];
    const times: number[] = [];
    for (let round = 0; round < 5; round += 1) {
      for (const q of queries) {
        const t = performance.now();
        searchSettings(q, s, { entries });
        times.push(performance.now() - t);
      }
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length / 2)]).toBeLessThan(SEARCH_MEDIAN_BUDGET_MS);
  });
});
