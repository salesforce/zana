import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createEnvironment, openDatabase, upsertHost, createThread, type ZccDatabase } from '@zana-ai/zcc-db';
import { unmanagedAttachRefusal } from './workspace-path-claims.js';

let db: ZccDatabase | null = null;
let dir: string | null = null;

afterEach(() => {
  db?.close();
  db = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe('workspace path claims', () => {
  it('refuses attaching to another project\'s managed path and busy checkout', () => {
    dir = mkdtempSync(join(tmpdir(), 'zcc-claim-'));
    db = openDatabase(join(dir, 'zcc.sqlite'));
    const host = upsertHost(db, { name: 'laptop', hostKeyHash: 'h'.repeat(64) });
    const managed = createEnvironment(db, {
      projectId: 'proj-a',
      hostId: host.id,
      path: join(dir, 'worktrees/env/demo'),
      workspaceProvisionType: 'managed-worktree',
      status: 'ready'
    });
    expect(unmanagedAttachRefusal(db, {
      dataDir: dir,
      checksOutBranch: false,
      hostId: host.id,
      path: managed.path!,
      projectId: 'proj-b'
    })?.reason).toBe('foreign-managed');

    const shared = join(dir, 'shared');
    createEnvironment(db, {
      projectId: 'proj-a',
      hostId: host.id,
      path: shared,
      workspaceProvisionType: 'unmanaged',
      status: 'ready'
    });
    const env = createEnvironment(db, {
      projectId: 'proj-b',
      hostId: host.id,
      path: shared,
      workspaceProvisionType: 'unmanaged',
      status: 'ready'
    });
    createThread(db, {
      projectId: 'proj-b',
      hostId: host.id,
      environmentId: env.id,
      providerId: 'claude',
      status: 'running'
    });
    expect(unmanagedAttachRefusal(db, {
      dataDir: dir,
      checksOutBranch: true,
      hostId: host.id,
      path: shared,
      projectId: 'proj-a'
    })?.reason).toBe('live-thread');
  });
});
