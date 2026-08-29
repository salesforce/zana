import { describe, it, expect, vi } from 'vitest';
import {
  AutoReportLinkerService,
  isReportCandidatePath,
  type AutoReportDeps,
  type AutoReportSessionInfo
} from '../auto-report-linker.js';
import type { InboxInput } from '../inbox-store.js';
import type { SessionStats } from '../../shared/types.js';

function stats(files: SessionStats['files']): SessionStats {
  return { files, queue: [] };
}

describe('isReportCandidatePath', () => {
  it('matches a keyword anywhere in the filename', () => {
    expect(isReportCandidatePath('/proj/weather_forecast_europe_report.md', '/proj')).toBe(true);
    expect(isReportCandidatePath('/proj/RCA-2026-08-01.md', '/proj')).toBe(true);
    expect(isReportCandidatePath('/proj/docs/audit-summary.md', '/proj')).toBe(true);
  });

  it('matches a bare markdown file at cwd root with no keyword', () => {
    expect(isReportCandidatePath('/proj/weather.md', '/proj')).toBe(true);
  });

  it('rejects a bare markdown file nested in a subdir with no keyword', () => {
    expect(isReportCandidatePath('/proj/docs/weather.md', '/proj')).toBe(false);
  });

  it('rejects common non-report root files', () => {
    expect(isReportCandidatePath('/proj/README.md', '/proj')).toBe(false);
    expect(isReportCandidatePath('/proj/CLAUDE.md', '/proj')).toBe(false);
  });

  it('rejects non-markdown files', () => {
    expect(isReportCandidatePath('/proj/report.txt', '/proj')).toBe(false);
  });

  it('rejects a bare (non-keyword) markdown file outside cwd', () => {
    expect(isReportCandidatePath('/other/weather.md', '/proj')).toBe(false);
  });
});

describe('AutoReportLinkerService', () => {
  function makeDeps(over: Partial<AutoReportDeps> = {}) {
    const appended: InboxInput[] = [];
    const session: AutoReportSessionInfo = {
      projectId: 'p1',
      profile: 'claude',
      cwd: '/proj',
      claudeSessionId: 'c1'
    };
    const filesByCall: SessionStats[] = [];
    let callIdx = 0;
    const deps: AutoReportDeps = {
      isEnabled: () => true,
      getSession: () => session,
      hasTranscript: () => true,
      readStats: vi.fn(async () => filesByCall[callIdx++] ?? filesByCall[filesByCall.length - 1] ?? null),
      projectRoot: () => '/proj',
      toProjectRelative: (root, abs) => (abs.startsWith(root) ? abs.slice(root.length + 1) : null),
      projectLabel: () => 'Proj',
      resolveOrigin: () => ({ claudeSessionId: 'c1' }),
      alreadyLinked: vi.fn(async () => false),
      appendInbox: vi.fn(async (input: InboxInput) => {
        appended.push(input);
        return { id: 'e1' };
      }),
      ...over
    };
    return { deps, appended, session, filesByCall };
  }

  it('links a newly-written report file on the idle edge', async () => {
    const { deps, appended, filesByCall } = makeDeps();
    filesByCall.push(stats([{ path: '/proj/weather_forecast_europe_report.md', op: 'C' }]));
    const svc = new AutoReportLinkerService(deps);
    svc.observe('s1', 'idle');
    await flush();
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({
      projectId: 'p1',
      sessionId: 's1',
      report: true,
      docs: [{ path: 'weather_forecast_europe_report.md' }],
      origin: { claudeSessionId: 'c1' }
    });
  });

  it('links a newly-written report file on the waiting edge (non-OSC harness rest state)', async () => {
    const { deps, appended, filesByCall } = makeDeps({
      getSession: () => ({
        projectId: 'p1',
        profile: 'codex',
        cwd: '/proj',
        openCodeSessionId: 'o1'
      })
    });
    filesByCall.push(stats([{ path: '/proj/weather_forecast_europe_report.md', op: 'C' }]));
    const svc = new AutoReportLinkerService(deps);
    svc.observe('s1', 'waiting');
    await flush();
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({
      projectId: 'p1',
      sessionId: 's1',
      report: true,
      docs: [{ path: 'weather_forecast_europe_report.md' }]
    });
  });

  it('does not re-link the same file on a later idle edge', async () => {
    const { deps, appended, filesByCall } = makeDeps();
    filesByCall.push(stats([{ path: '/proj/report.md', op: 'C' }]));
    const svc = new AutoReportLinkerService(deps);
    svc.observe('s1', 'idle');
    await flush();
    svc.observe('s1', 'working');
    svc.observe('s1', 'idle');
    await flush();
    expect(appended).toHaveLength(1);
  });

  it('ignores a Read-only touch', async () => {
    const { deps, appended, filesByCall } = makeDeps();
    filesByCall.push(stats([{ path: '/proj/report.md', op: 'R' }]));
    const svc = new AutoReportLinkerService(deps);
    svc.observe('s1', 'idle');
    await flush();
    expect(appended).toHaveLength(0);
  });

  it('ignores a non-report file', async () => {
    const { deps, appended, filesByCall } = makeDeps();
    filesByCall.push(stats([{ path: '/proj/index.ts', op: 'C' }]));
    const svc = new AutoReportLinkerService(deps);
    svc.observe('s1', 'idle');
    await flush();
    expect(appended).toHaveLength(0);
  });

  it('is a no-op when disabled', async () => {
    const { deps, appended, filesByCall } = makeDeps({ isEnabled: () => false });
    filesByCall.push(stats([{ path: '/proj/report.md', op: 'C' }]));
    const svc = new AutoReportLinkerService(deps);
    svc.observe('s1', 'idle');
    await flush();
    expect(appended).toHaveLength(0);
  });

  it('skips a scheduled/background session', async () => {
    const { deps, appended, filesByCall } = makeDeps({
      getSession: () => ({
        projectId: 'p1',
        profile: 'claude',
        cwd: '/proj',
        claudeSessionId: 'c1',
        scheduled: true
      })
    });
    filesByCall.push(stats([{ path: '/proj/report.md', op: 'C' }]));
    const svc = new AutoReportLinkerService(deps);
    svc.observe('s1', 'idle');
    await flush();
    expect(appended).toHaveLength(0);
  });

  it('defers to the store dedup check for a file already linked (e.g. by a manual inbox_push)', async () => {
    const { deps, appended, filesByCall } = makeDeps({ alreadyLinked: vi.fn(async () => true) });
    filesByCall.push(stats([{ path: '/proj/report.md', op: 'C' }]));
    const svc = new AutoReportLinkerService(deps);
    svc.observe('s1', 'idle');
    await flush();
    expect(appended).toHaveLength(0);
  });

  it('ignores non-idle transitions', async () => {
    const { deps, appended, filesByCall } = makeDeps();
    filesByCall.push(stats([{ path: '/proj/report.md', op: 'C' }]));
    const svc = new AutoReportLinkerService(deps);
    svc.observe('s1', 'working');
    svc.observe('s1', 'blocked');
    await flush();
    expect(appended).toHaveLength(0);
  });

  it('remove() clears the dedup set so a re-created session can re-link', async () => {
    const { deps, appended, filesByCall } = makeDeps();
    filesByCall.push(stats([{ path: '/proj/report.md', op: 'C' }]));
    const svc = new AutoReportLinkerService(deps);
    svc.observe('s1', 'idle');
    await flush();
    svc.remove('s1');
    svc.observe('s1', 'idle');
    await flush();
    expect(appended).toHaveLength(2);
  });

  it('never throws when appendInbox rejects', async () => {
    const { deps, filesByCall } = makeDeps({
      appendInbox: vi.fn(async () => {
        throw new Error('disk full');
      })
    });
    filesByCall.push(stats([{ path: '/proj/report.md', op: 'C' }]));
    const svc = new AutoReportLinkerService(deps);
    expect(() => svc.observe('s1', 'idle')).not.toThrow();
    await flush();
  });
});

/** Let queued microtasks (the fire-and-forget scan promise chain) settle. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}
