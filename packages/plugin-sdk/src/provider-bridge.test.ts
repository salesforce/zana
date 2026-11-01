import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  approvalInteractionOutcomeSchema,
  experimental_buildBridgeToolCallContent,
  experimental_createConfinedConfigLeaf,
  experimental_linkProjects,
  experimental_planStepsPresentation,
  experimental_recordProviderChildIo,
  experimental_removeUnlessRealDirectory,
  experimental_runPortableCommand,
  experimental_removeConfinedConfigLeaf,
  experimental_sweepConfinedConfigLeaves,
  experimental_writeAtomic0600,
  experimental_spawnPortablePipedProcess,
  experimental_spawnPortableProcess,
  isApprovalInteractionOutcome,
  planStepsPresentation,
  userQuestionInteractionOutcomeSchema
} from './provider-bridge.js';

let lifecycleDir: string | undefined;
afterEach(() => {
  if (lifecycleDir) rmSync(lifecycleDir, { recursive: true, force: true });
  lifecycleDir = undefined;
});

describe('provider-bridge facade', () => {
  it('lets provider hosts run bounded probes through the public SDK', async () => {
    const result = await experimental_runPortableCommand(process.execPath,
      ['-e', 'process.stdout.write("x".repeat(16000));process.stderr.write("diagnostic")'],
      { timeout: 5000 });
    expect(result).toEqual({ stdout: 'x'.repeat(16000), stderr: 'diagnostic' });
    expect(typeof experimental_spawnPortablePipedProcess).toBe('function');
    expect(typeof experimental_spawnPortableProcess).toBe('function');
  });
  it('lets bridges remove a link they made without touching its target', () => {
    const base = mkdtempSync(join(tmpdir(), 'zcc-sdk-remove-link-'));
    try {
      const target = join(base, 'user-skills');
      mkdirSync(target);
      writeFileSync(join(target, 'SKILL.md'), 'keep me\n');
      const link = join(base, 'skills');
      symlinkSync(target, link, 'junction');

      expect(experimental_removeUnlessRealDirectory(link)).toBe(true);
      expect(existsSync(link)).toBe(false);
      expect(existsSync(join(target, 'SKILL.md'))).toBe(true);
      expect(experimental_removeUnlessRealDirectory(target)).toBe(false);
      expect(existsSync(join(target, 'SKILL.md'))).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
  it('exports approvalInteractionOutcomeSchema for provider host bundles', () => {
    expect(typeof approvalInteractionOutcomeSchema.parse).toBe('function');
    expect(approvalInteractionOutcomeSchema.safeParse({ payload: {}, resolution: {} }).success).toBe(false);
  });

  it('exports user-question and approval outcome helpers for Claude host bundles', () => {
    expect(typeof userQuestionInteractionOutcomeSchema.parse).toBe('function');
    expect(typeof isApprovalInteractionOutcome).toBe('function');
  });

  it('exports experimental_buildBridgeToolCallContent for MCP tool-proxy servers', () => {
    expect(experimental_buildBridgeToolCallContent({ content: 'OK' })).toEqual([
      { type: 'text', text: 'OK' }
    ]);
  });

  it('exports experimental_recordProviderChildIo for ACP host bundles', () => {
    expect(typeof experimental_recordProviderChildIo).toBe('function');
  });

  it('exports planStepsPresentation as the stable plan-steps helper', () => {
    expect(typeof planStepsPresentation).toBe('function');
    expect(experimental_planStepsPresentation).toBe(planStepsPresentation);
    expect(planStepsPresentation([{ step: 'Ship', status: 'active' }])).toMatchObject({
      label: { pending: 'Updating plan', completed: 'Updated plan' },
      icon: { glyph: 'ListTodo' },
      suppress: true,
      title: 'Ship'
    });
  });

  it('owns confined config leaf lifecycle for provider hosts and daemon consumers', () => {
    lifecycleDir = mkdtempSync(join(tmpdir(), 'zcc-sdk-config-'));
    const sourceProjects = join(lifecycleDir, 'source-projects');
    const old = experimental_createConfinedConfigLeaf({
      dataDir: lifecycleDir,
      parentName: 'automated-config',
      ownerId: 'old',
    });
    const live = experimental_createConfinedConfigLeaf({
      dataDir: lifecycleDir,
      parentName: 'automated-config',
      ownerId: 'live',
    });
    experimental_writeAtomic0600(join(old, 'settings.json'), '{}');
    expect(statSync(join(old, 'settings.json')).mode & 0o777).toBe(0o600);
    experimental_linkProjects(sourceProjects, join(old, 'projects'));
    expect(lstatSync(join(old, 'projects')).isSymbolicLink()).toBe(true);
    const past = new Date(Date.now() - 10_000);
    utimesSync(old, past, past);
    utimesSync(live, past, past);

    expect(
      experimental_sweepConfinedConfigLeaves({
        dataDir: lifecycleDir,
        parentName: 'automated-config',
        liveOwnerIds: new Set(['live']),
        ttlMs: 5_000,
      }),
    ).toEqual(['old']);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(live)).toBe(true);
    expect(existsSync(sourceProjects)).toBe(true);
  });

  it('rejects unsafe owner ids, parent names, and removal outside the configured parent', () => {
    lifecycleDir = mkdtempSync(join(tmpdir(), 'zcc-sdk-config-'));
    expect(() =>
      experimental_createConfinedConfigLeaf({
        dataDir: lifecycleDir!,
        parentName: 'automated-config',
        ownerId: '..',
      }),
    ).toThrow(/invalid/);
    expect(() =>
      experimental_removeConfinedConfigLeaf(lifecycleDir!, 'automated-config', lifecycleDir!),
    ).toThrow(/escapes/);
    expect(() =>
      experimental_createConfinedConfigLeaf({
        dataDir: lifecycleDir!,
        parentName: '../outside',
        ownerId: 'owner',
      }),
    ).toThrow(/parent name/);
  });

  it('rejects a symlinked lifecycle parent or leaf', () => {
    lifecycleDir = mkdtempSync(join(tmpdir(), 'zcc-sdk-config-'));
    const parent = join(lifecycleDir, 'automated-config');
    const target = join(lifecycleDir, 'target');
    mkdirSync(target);
    symlinkSync(target, parent, 'dir');
    expect(() =>
      experimental_createConfinedConfigLeaf({
        dataDir: lifecycleDir!,
        parentName: 'automated-config',
        ownerId: 'owner',
      }),
    ).toThrow(/symlink/);

    rmSync(parent);
    mkdirSync(parent);
    symlinkSync(target, join(parent, 'owner'), 'dir');
    expect(() =>
      experimental_createConfinedConfigLeaf({
        dataDir: lifecycleDir!,
        parentName: 'automated-config',
        ownerId: 'owner',
      }),
    ).toThrow(/symlink/);
  });

  it('removes a stale symlinked leaf without following its target', () => {
    lifecycleDir = mkdtempSync(join(tmpdir(), 'zcc-sdk-config-'));
    const parent = join(lifecycleDir, 'automated-config');
    const target = join(lifecycleDir, 'target');
    const leaf = join(parent, 'stale');
    mkdirSync(parent);
    mkdirSync(target);
    symlinkSync(target, leaf, 'dir');

    experimental_removeConfinedConfigLeaf(lifecycleDir, 'automated-config', leaf);

    expect(existsSync(leaf)).toBe(false);
    expect(existsSync(target)).toBe(true);
  });
});
