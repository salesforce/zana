import { describe, it, expect, vi } from 'vitest';
import {
  InboxSummaryService,
  parseInboxDigest,
  parseDetailedInboxDigest,
  renderEntriesForPrompt,
  entryGist,
  INBOX_SUMMARY_MAX_ENTRIES,
  type InboxSummaryDeps
} from '@zana-ai/zcc-server';
import type { InboxEntry, LlmRunResult } from '@zana-ai/zcc-domain/product';

const NOW = 1_700_000_000_000;

function entry(over: Partial<InboxEntry> = {}): InboxEntry {
  return {
    id: 'e1',
    ts: NOW - 60_000,
    projectId: 'p1',
    comments: 'Fixed the login redirect',
    ...over
  } as InboxEntry;
}

describe('entryGist', () => {
  it('uses the first non-empty comment line, stripping markdown markers', () => {
    expect(entryGist(entry({ comments: '## Heading\n\nbody' }))).toBe('Heading');
    expect(entryGist(entry({ comments: '- a bullet' }))).toBe('a bullet');
    expect(entryGist(entry({ comments: '\n\n  Real line  \nsecond' }))).toBe('Real line');
  });

  it('falls back to the first doc path with a (+N more) suffix', () => {
    const e = entry({
      comments: '',
      docs: [{ path: 'docs/a.md' }, { path: 'docs/b.md' }] as InboxEntry['docs']
    });
    expect(entryGist(e)).toBe('📄 docs/a.md (+1 more)');
  });

  it('returns empty when there is nothing to show', () => {
    expect(entryGist(entry({ comments: '', docs: [] }))).toBe('');
  });
});

describe('renderEntriesForPrompt', () => {
  const projectLabel = (id: string) => (id === 'p1' ? 'Proj One' : undefined);

  it('renders one line per entry with project tag + relative age when unscoped', () => {
    const out = renderEntriesForPrompt(
      [entry({ comments: 'Did a thing', ts: NOW - 120_000 })],
      { scoped: false, now: NOW, projectLabel }
    );
    expect(out).toBe('- [Proj One · 2m ago] Did a thing');
  });

  it('drops the project tag when scoped to one project', () => {
    const out = renderEntriesForPrompt([entry({ comments: 'Scoped thing' })], {
      scoped: true,
      now: NOW,
      projectLabel
    });
    expect(out).toBe('- [1m ago] Scoped thing');
  });

  it('appends a ×N occurrence count and skips gist-less entries', () => {
    const out = renderEntriesForPrompt(
      [
        entry({ id: 'a', comments: 'Coalesced', occurrences: 3 }),
        entry({ id: 'b', comments: '', docs: [] })
      ],
      { scoped: true, now: NOW, projectLabel }
    );
    expect(out).toBe('- [1m ago] Coalesced ×3');
  });
});

describe('parseInboxDigest', () => {
  it('parses a clean minified JSON reply', () => {
    expect(
      parseInboxDigest('{"headline":"Quiet day","done":["Shipped X"],"attention":["Review Y"]}')
    ).toEqual({ headline: 'Quiet day', done: ['Shipped X'], attention: ['Review Y'] });
  });

  it('tolerates surrounding prose / code fences', () => {
    expect(parseInboxDigest('```json\n{"headline":"H","done":[],"attention":[]}\n```')).toEqual({
      headline: 'H',
      done: [],
      attention: []
    });
  });

  it('clamps to 5 bullets each and trims/length-caps strings', () => {
    const many = JSON.stringify({
      headline: 'x'.repeat(300),
      done: Array.from({ length: 9 }, (_, i) => `d${i}`),
      attention: ['  spaced  ']
    });
    const out = parseInboxDigest(many)!;
    expect(out.headline.length).toBe(160);
    expect(out.done).toHaveLength(5);
    expect(out.attention).toEqual(['spaced']);
  });

  it('returns null on empty headline / non-JSON / empty', () => {
    expect(parseInboxDigest('{"headline":"","done":[],"attention":[]}')).toBeNull();
    expect(parseInboxDigest('not json')).toBeNull();
    expect(parseInboxDigest('')).toBeNull();
  });
});

describe('InboxSummaryService.summarize', () => {
  const okResult = (text: string): LlmRunResult => ({ ok: true, text, provider: 'claude-cli', ms: 1 });

  function makeDeps(over: Partial<InboxSummaryDeps> = {}): InboxSummaryDeps {
    return {
      readEntries: vi.fn(async () => [entry({ comments: 'Did a thing' })]),
      runSummary: vi.fn(async () =>
        okResult('{"headline":"All caught up","done":["Did a thing"],"attention":[]}')
      ),
      projectLabel: () => 'Proj One',
      ...over
    };
  }

  it('reads main’s store, runs the micro-call, and returns a parsed digest', async () => {
    const deps = makeDeps();
    const res = await new InboxSummaryService(deps, () => NOW).summarize('p1');
    expect(res).toEqual({
      ok: true,
      digest: { headline: 'All caught up', done: ['Did a thing'], attention: [] },
      entryCount: 1
    });
    // Bounded read against main's own store, scoped to the project.
    expect(deps.readEntries).toHaveBeenCalledWith('p1', INBOX_SUMMARY_MAX_ENTRIES);
    // Dedupe key is scope-specific so a debounce + manual click coalesce.
    const dedupeKey = (deps.runSummary as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(dedupeKey).toBe('inbox-summary:p1');
  });

  it('uses the “all” dedupe key for an unscoped (global) summary', async () => {
    const deps = makeDeps();
    await new InboxSummaryService(deps, () => NOW).summarize(null);
    expect(deps.readEntries).toHaveBeenCalledWith(null, INBOX_SUMMARY_MAX_ENTRIES);
    expect((deps.runSummary as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBe('inbox-summary:all');
  });

  it('reports empty when the inbox has no entries (no call spent)', async () => {
    const deps = makeDeps({ readEntries: vi.fn(async () => []) });
    const res = await new InboxSummaryService(deps, () => NOW).summarize('p1');
    expect(res).toEqual({ ok: false, reason: 'empty' });
    expect(deps.runSummary).not.toHaveBeenCalled();
  });

  it('reports empty when entries exist but none have a gist (no call spent)', async () => {
    const deps = makeDeps({
      readEntries: vi.fn(async () => [entry({ comments: '', docs: [] })])
    });
    const res = await new InboxSummaryService(deps, () => NOW).summarize('p1');
    expect(res).toEqual({ ok: false, reason: 'empty' });
    expect(deps.runSummary).not.toHaveBeenCalled();
  });

  it('reports summary-failed on an LLM error, an empty reply, or unparsable JSON', async () => {
    const llmErr = makeDeps({
      runSummary: vi.fn(
        async (): Promise<LlmRunResult> => ({ ok: false, text: '', error: 'boom', provider: 'claude-cli', ms: 1 })
      )
    });
    expect(await new InboxSummaryService(llmErr, () => NOW).summarize('p1')).toEqual({
      ok: false,
      reason: 'summary-failed'
    });

    const blank = makeDeps({ runSummary: vi.fn(async () => okResult('   ')) });
    expect(await new InboxSummaryService(blank, () => NOW).summarize('p1')).toEqual({
      ok: false,
      reason: 'summary-failed'
    });

    const garbage = makeDeps({ runSummary: vi.fn(async () => okResult('totally not json')) });
    expect(await new InboxSummaryService(garbage, () => NOW).summarize('p1')).toEqual({
      ok: false,
      reason: 'summary-failed'
    });
  });
});

describe('parseDetailedInboxDigest', () => {
  // Resolver stands in for main's name→id map (only "Proj One" is a live project).
  const resolve = (name: string): string | null => (name === 'Proj One' ? 'p1' : null);

  it('parses sections + points, resolving the model’s project NAME to an id', () => {
    const text = JSON.stringify({
      headline: 'One thing shipped, one blocked',
      sections: [
        {
          title: 'Auth',
          points: [
            { text: 'Login redirect fixed', kind: 'done' },
            {
              text: 'Token refresh failing',
              kind: 'attention',
              project: 'Proj One',
              suggestedPrompt: 'Investigate the token refresh 401s'
            }
          ]
        }
      ]
    });
    const digest = parseDetailedInboxDigest(text, resolve, null);
    expect(digest).toEqual({
      headline: 'One thing shipped, one blocked',
      sections: [
        {
          title: 'Auth',
          points: [
            { text: 'Login redirect fixed', kind: 'done' },
            {
              text: 'Token refresh failing',
              kind: 'attention',
              projectId: 'p1',
              suggestedPrompt: 'Investigate the token refresh 401s'
            }
          ]
        }
      ]
    });
  });

  it('drops projectId + suggestedPrompt when the model’s project name is unknown (Rule 1)', () => {
    const text = JSON.stringify({
      headline: 'h',
      sections: [
        {
          title: 'S',
          points: [
            {
              text: 'Do a thing',
              kind: 'attention',
              project: 'Hallucinated Project',
              suggestedPrompt: 'spawn me somewhere'
            }
          ]
        }
      ]
    });
    const digest = parseDetailedInboxDigest(text, resolve, null);
    expect(digest?.sections[0].points[0]).toEqual({ text: 'Do a thing', kind: 'attention' });
  });

  it('forces every point to the scope id when scoped, ignoring the model’s name', () => {
    const text = JSON.stringify({
      headline: 'h',
      sections: [
        {
          title: 'S',
          points: [
            {
              text: 'A',
              kind: 'done',
              project: 'Some Other Name',
              suggestedPrompt: 'go'
            }
          ]
        }
      ]
    });
    const digest = parseDetailedInboxDigest(text, resolve, 'scoped-proj');
    expect(digest?.sections[0].points[0]).toEqual({
      text: 'A',
      kind: 'done',
      projectId: 'scoped-proj',
      suggestedPrompt: 'go'
    });
  });

  it('drops an actionable prompt with no resolvable project (no dead spawn)', () => {
    const text = JSON.stringify({
      headline: 'h',
      sections: [{ title: 'S', points: [{ text: 'A', kind: 'done', suggestedPrompt: 'go' }] }]
    });
    const digest = parseDetailedInboxDigest(text, resolve, null);
    expect(digest?.sections[0].points[0]).toEqual({ text: 'A', kind: 'done' });
  });

  it('coerces an unknown kind to "done" and skips point/section with no text/title', () => {
    const text = JSON.stringify({
      headline: 'h',
      sections: [
        { title: '', points: [{ text: 'hidden', kind: 'done' }] },
        {
          title: 'Keep',
          points: [
            { text: 'kept', kind: 'wat' },
            { text: '', kind: 'done' }
          ]
        }
      ]
    });
    const digest = parseDetailedInboxDigest(text, resolve, null);
    expect(digest?.sections).toEqual([{ title: 'Keep', points: [{ text: 'kept', kind: 'done' }] }]);
  });

  it('extracts the JSON object from surrounding prose/fences; nulls on no headline', () => {
    const wrapped = 'here you go:\n```json\n{"headline":"H","sections":[]}\n```\n';
    expect(parseDetailedInboxDigest(wrapped, resolve, null)).toEqual({ headline: 'H', sections: [] });
    expect(parseDetailedInboxDigest('{"sections":[]}', resolve, null)).toBeNull();
    expect(parseDetailedInboxDigest('not json', resolve, null)).toBeNull();
    expect(parseDetailedInboxDigest('', resolve, null)).toBeNull();
  });
});

describe('InboxSummaryService.summarizeDetailed', () => {
  const okResult = (text: string): LlmRunResult => ({ ok: true, text, provider: 'claude-cli', ms: 1 });
  const detailedJson = JSON.stringify({
    headline: 'H',
    sections: [
      { title: 'S', points: [{ text: 'p', kind: 'done', project: 'Proj One', suggestedPrompt: 'go' }] }
    ]
  });

  function makeDeps(over: Partial<InboxSummaryDeps> = {}): InboxSummaryDeps {
    return {
      readEntries: vi.fn(async () => [entry({ comments: 'Did a thing' })]),
      runSummary: vi.fn(async () => okResult('{"headline":"h","done":[],"attention":[]}')),
      runDetailedSummary: vi.fn(async () => okResult(detailedJson)),
      projectLabel: () => 'Proj One',
      resolveProjectByName: (n) => (n === 'Proj One' ? 'p1' : null),
      ...over
    };
  }

  it('runs the detailed micro-call and returns a parsed, project-resolved digest', async () => {
    const deps = makeDeps();
    const res = await new InboxSummaryService(deps, () => NOW).summarizeDetailed('p1');
    expect(res).toEqual({
      ok: true,
      digest: {
        headline: 'H',
        sections: [
          { title: 'S', points: [{ text: 'p', kind: 'done', projectId: 'p1', suggestedPrompt: 'go' }] }
        ]
      },
      entryCount: 1
    });
    const dedupeKey = (deps.runDetailedSummary as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(dedupeKey).toBe('inbox-summary-detailed:p1');
  });

  it('fails closed when the detailed deps are absent (no runDetailedSummary/resolve)', async () => {
    const deps = makeDeps({ runDetailedSummary: undefined, resolveProjectByName: undefined });
    const res = await new InboxSummaryService(deps, () => NOW).summarizeDetailed('p1');
    expect(res).toEqual({ ok: false, reason: 'summary-failed' });
  });

  it('reports empty with no entries (no call spent)', async () => {
    const deps = makeDeps({ readEntries: vi.fn(async () => []) });
    const res = await new InboxSummaryService(deps, () => NOW).summarizeDetailed(null);
    expect(res).toEqual({ ok: false, reason: 'empty' });
    expect(deps.runDetailedSummary).not.toHaveBeenCalled();
  });
});
