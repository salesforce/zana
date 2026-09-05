import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  isSubstantialPlanDraft,
  isPlanArtifactPath,
  planFileSlug,
  writeThreadPlanFile
} from './thread-plan-files.js';

let dir: string | null = null;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe('thread plan files', () => {
  it('slugs a heading and treats short non-heading text as insubstantial', () => {
    expect(planFileSlug('# Ship the widget\n\nDo the work.', 'thr-1')).toBe('ship-the-widget');
    expect(planFileSlug('no heading', 'thread_abc')).toBe('thread_abc');
    expect(isSubstantialPlanDraft('ok')).toBe(false);
    expect(isSubstantialPlanDraft('# Overview\n\nDo it.')).toBe(true);
    expect(isSubstantialPlanDraft('x'.repeat(200))).toBe(true);
  });

  it('writes a confined plan file and skips identical bodies', () => {
    dir = mkdtempSync(join(tmpdir(), 'zcc-plan-file-'));
    const root = realpathSync(dir);
    const first = writeThreadPlanFile({
      projectRoot: dir,
      markdown: '# Ship\n\nDo the work.',
      fallbackId: 'thr-1'
    });
    expect(first).toBe(join(root, '.zcc', 'plans', 'ship.plan.md'));
    expect(readFileSync(first!, 'utf8')).toBe('# Ship\n\nDo the work.');
    const again = writeThreadPlanFile({
      projectRoot: dir,
      markdown: '# Ship\n\nDo the work.',
      fallbackId: 'thr-1',
      existingPath: first
    });
    expect(again).toBe(first);
  });

  it('keeps a confined existingPath even when it is not .plan.md', () => {
    dir = mkdtempSync(join(tmpdir(), 'zcc-plan-file-'));
    const root = realpathSync(dir);
    const legacy = join(root, '.zcc', 'plans', 'ship.md');
    mkdirSync(join(root, '.zcc', 'plans'), { recursive: true, mode: 0o700 });
    writeFileSync(legacy, '# Ship\n\nDo the work.', { encoding: 'utf8', mode: 0o600 });
    const written = writeThreadPlanFile({
      projectRoot: dir,
      markdown: '# Ship\n\nUpdated.',
      fallbackId: 'thr-1',
      existingPath: legacy
    });
    expect(written).toBe(legacy);
    expect(readFileSync(legacy, 'utf8')).toBe('# Ship\n\nUpdated.');
    expect(existsSync(join(root, '.zcc', 'plans', 'ship.plan.md'))).toBe(false);
  });

  it('returns null when the project root cannot be confined', () => {
    dir = mkdtempSync(join(tmpdir(), 'zcc-plan-file-'));
    expect(writeThreadPlanFile({
      projectRoot: join(dir, 'missing'),
      markdown: '# Ship',
      fallbackId: 'thr-1'
    })).toBeNull();
  });

  it('rejects a dest that escapes the project', () => {
    dir = mkdtempSync(join(tmpdir(), 'zcc-plan-file-'));
    const root = realpathSync(dir);
    const outside = mkdtempSync(join(tmpdir(), 'zcc-plan-out-'));
    mkdirSync(join(dir, '.zcc', 'plans'), { recursive: true });
    const escaped = join(outside, 'escape.md');
    writeFileSync(escaped, 'nope');
    const written = writeThreadPlanFile({
      projectRoot: dir,
      markdown: '# Nope',
      fallbackId: 'thr-1',
      existingPath: escaped
    });
    expect(written).toBe(join(root, '.zcc', 'plans', 'nope.plan.md'));
    expect(existsSync(escaped)).toBe(true);
    expect(readFileSync(escaped, 'utf8')).toBe('nope');
    rmSync(outside, { recursive: true, force: true });
  });

  it('confines plan artifact paths to .zcc/plans markdown', () => {
    dir = mkdtempSync(join(tmpdir(), 'zcc-plan-file-'));
    const root = realpathSync(dir);
    mkdirSync(join(root, '.zcc', 'plans'), { recursive: true, mode: 0o700 });
    const plan = join(root, '.zcc', 'plans', 'ship.plan.md');
    const legacy = join(root, '.zcc', 'plans', 'ship.md');
    writeFileSync(plan, '# Ship', { encoding: 'utf8', mode: 0o600 });
    writeFileSync(legacy, '# Ship', { encoding: 'utf8', mode: 0o600 });
    expect(isPlanArtifactPath(root, plan)).toBe(true);
    expect(isPlanArtifactPath(root, legacy)).toBe(true);
    expect(isPlanArtifactPath(root, join(root, 'src', 'foo.ts'))).toBe(false);
    expect(isPlanArtifactPath(root, join(root, '.zcc', 'plans', '..', 'secret.ts'))).toBe(false);
    const outside = mkdtempSync(join(tmpdir(), 'zcc-plan-out-'));
    expect(isPlanArtifactPath(root, join(outside, 'escape.md'))).toBe(false);
    rmSync(outside, { recursive: true, force: true });
  });
});
