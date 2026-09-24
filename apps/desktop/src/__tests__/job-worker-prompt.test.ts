import { describe, it, expect, vi } from 'vitest';

/**
 * `jobWorkerPrompt` is exported from host.ts and controls the whole worker
 * standby contract: what a worker is told to do with an assignment, which
 * audience to pick when it must block, and how it consumes a delivered
 * response. Mirrors the lean mocking approach in
 * goal-execution-source-paths.test.ts / opencode-tab-namer.test.ts so
 * importing host.ts is side-effect-free.
 */

vi.mock('@zana-ai/zcc-host-daemon/pty', () => ({
  PtyManager: class {
    setMcpBaseUrl() {}
    setProjectRoots() {}
    setRulesResolver() {}
  },
  isClaudeProfile: () => false
}));

vi.mock('@zana-ai/zcc-server/services/projects/store', () => ({
  store: {
    listProjects: () => [],
    getConfig: () => ({}),
    getProjectSettings: () => ({}),
    createScratchSubfolder: () => '/tmp/scratch'
  },
  scratchWorkspaceRoot: () => '/tmp/scratch-root',
  worktreeRoot: () => '/tmp/zcc-worktrees',
  worktreeTargetDir: (_p: unknown, slug: string) => `/tmp/zcc-worktrees/${slug}`
}));

vi.mock('electron', () => ({
  safeStorage: { isEncryptionAvailable: () => false },
  app: {
    on: () => {},
    whenReady: () => new Promise(() => {}),
    getPath: () => '/tmp',
    setName: () => {},
    requestSingleInstanceLock: () => true,
    quit: () => {}
  },
  BrowserWindow: {
    getAllWindows: () => [],
    getFocusedWindow: () => null
  },
  ipcMain: { handle: () => {}, on: () => {} },
  dialog: {},
  shell: {},
  screen: {},
  Menu: { setApplicationMenu: () => {}, buildFromTemplate: () => ({}) },
  nativeImage: { createFromPath: () => ({}) },
  powerMonitor: { on: () => {} }
}));

vi.mock('../updater.js', () => ({
  createUpdater: () => ({})
}));

vi.mock('-ai/zcc-host-daemon/mcp-config', () => ({
  ensureMcpConfigForProject: () => '/tmp/p1/.mcp.json',
  ensureMcpConfigForProjectSync: () => '/tmp/p1/.mcp.json',
  alwaysOnPluginMcpAllowlist: () => []
}));

vi.mock('../test-tap.js', () => ({
  record: () => {},
  recordLog: () => {},
  isEnabled: () => false,
  enable: () => {},
  drain: () => ({ entries: [], cursor: 0 }),
  snapshot: () => ({ entries: [] }),
  reset: () => {}
}));

const { jobWorkerPrompt } = await import('../host.js');

const withExecution = jobWorkerPrompt({ executionId: 'exec-1', slotId: 'slot-1', label: 'Worker 1', personaName: 'Builder' });
const withoutExecution = jobWorkerPrompt({ slotId: 'slot-1', label: 'Worker 1', personaName: 'Builder' });

describe('jobWorkerPrompt — assignment', () => {
  it('directs the worker to EXECUTE the assigned unit, not wait for pushed source context', () => {
    expect(withExecution).toContain('EXECUTE it');
    expect(withExecution).toContain('the file scope');
    // the old reflexive-block framing must be gone
    expect(withExecution).not.toContain('containing the needed source context');
    expect(withExecution).not.toContain('do NOT infer or start independently');
    expect(withExecution).toMatch(/do not wait for extra "source context"/i);
    expect(withExecution).toContain('Do not block just because a task looks large or under-detailed');
  });

  it('names the slot, persona, and (when present) the execution id', () => {
    expect(withExecution).toContain('slot `slot-1`');
    expect(withExecution).toContain('Worker 1');
    expect(withExecution).toContain('Builder');
    expect(withExecution).toContain('in execution `exec-1`');
    // no execution id when the call omits it
    expect(withoutExecution).not.toContain('in execution');
  });

  it('scopes the worker to bounded work assigned to this slot, not the overall job', () => {
    expect(withExecution).toContain('Do not, however, start the overall job or units not assigned to this slot');
  });
});

describe('jobWorkerPrompt — audience selection', () => {
  it('teaches the two block audiences: coordinator for a decidable plan/spec choice, human for a real human decision', () => {
    expect(withExecution).toContain('audience: "coordinator"');
    expect(withExecution).toContain('audience: "human"');
    expect(withExecution).toContain('resumes automatically');
    // human is the default, reserved for a genuine human decision/credential
    expect(withExecution).toContain('the default) only when a real human decision or credential is required');
  });

  it('forbids blocking merely because a task looks large, and forbids AskUserQuestion', () => {
    expect(withExecution).toContain('Do not use AskUserQuestion');
    expect(withExecution).toContain('attempt it');
  });
});

describe('jobWorkerPrompt — delivery instructions', () => {
  it('closes every unit through exactly one structured outcome, never agent_send for routine progress', () => {
    expect(withExecution).toContain('execution.work.complete');
    expect(withExecution).toContain('execution.work.fail');
    expect(withExecution).toContain('execution.work.block');
    expect(withExecution).toContain('execution.work.release');
    expect(withExecution).toContain('Do not use `agent_send` for routine progress or results');
  });

  it('forbids polling and requires waiting for an injected notification before pulling', () => {
    expect(withExecution).toContain('Do not poll `agent_inbox`');
    expect(withExecution).toContain('do not poll `execution.delivery.pull`');
    expect(withExecution).toContain('Call `execution.delivery.pull` only after an injected notification');
  });

  it('treats delivery as at-least-once and requires an idempotency marker before applying a payload', () => {
    expect(withExecution).toContain('Delivery is at-least-once and may repeat after a crash');
    expect(withExecution).toContain('use the stable deliveryId as an idempotency key');
    expect(withExecution).toContain('persist a completed-application marker only after successful application');
    expect(withExecution).toContain('If that completed marker already exists, do not apply the payload again');
  });

  it('acks with deliveryId and leaseId, and never reports an owner-only authorization denial as a delivery error', () => {
    expect(withExecution).toContain('call `execution.delivery.ack` with the deliveryId and leaseId');
    expect(withExecution).toContain('never call `execution.resume` or `execution.respond`');
    expect(withExecution).toContain('that authorization denial is NOT an application failure');
  });
});
