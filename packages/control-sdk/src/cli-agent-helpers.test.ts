import { describe, expect, it } from 'vitest';
import {
  SCENARIO_PROFILES,
  harnessRoutingFor,
  pidIsDead,
  writeAllowRouting
} from '../live/cli-agent-helpers.js';

describe('CLI Agent scenario helpers', () => {
  it('covers Claude Code, Cursor, Codex, and OpenCode', () => {
    expect([...SCENARIO_PROFILES]).toEqual(['claude', 'cursor', 'codex', 'opencode']);
  });

  it('routes OpenCode to the build role without a catalog model', () => {
    expect(harnessRoutingFor('claude')).toBeUndefined();
    expect(harnessRoutingFor('cursor')).toBeUndefined();
    expect(harnessRoutingFor('codex')).toBeUndefined();
    expect(harnessRoutingFor('opencode')).toEqual({
      schemaVersion: 1,
      byAdapter: { opencode: { roleTargetId: 'build' } }
    });
    const routing = harnessRoutingFor('opencode');
    expect(routing?.byAdapter.opencode?.modelTargetId).toBeUndefined();
    expect(routing?.byAdapter.opencode?.compatibility?.model).toBeUndefined();
  });

  it('routes file-edit via trusted autonomous executionState, not extraArgs', () => {
    expect(writeAllowRouting('claude')).toEqual({
      schemaVersion: 1,
      byAdapter: { claude: { executionState: 'autonomous' } }
    });
    expect(writeAllowRouting('cursor')).toEqual({
      schemaVersion: 1,
      byAdapter: { cursor: { executionState: 'autonomous' } }
    });
    expect(writeAllowRouting('codex')).toEqual({
      schemaVersion: 1,
      byAdapter: { codex: { executionState: 'autonomous' } }
    });
    expect(writeAllowRouting('opencode')).toEqual({
      schemaVersion: 1,
      byAdapter: { opencode: { executionState: 'autonomous' } }
    });
    expect(writeAllowRouting('opencode')?.byAdapter.opencode?.modelTargetId).toBeUndefined();
  });

  it('pidIsDead is true for a missing pid and false for this process', () => {
    expect(pidIsDead(process.pid)).toBe(false);
    expect(pidIsDead(2_147_483_647)).toBe(true);
  });
});
