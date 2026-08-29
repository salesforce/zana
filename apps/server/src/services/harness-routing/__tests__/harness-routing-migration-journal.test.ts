import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MigrationRepairRequiredError,
  runJournaledMigration,
  type MigrationJournalState
} from '../journal.js';
import { hashBytes } from '../storage.js';

const roots: string[] = [];

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'harness-routing-journal-'));
  roots.push(dir);
  const legacyPath = join(dir, 'legacy.json');
  const canonicalPath = join(dir, 'canonical.json');
  const journalPath = join(dir, 'migration.json');
  const backupPath = join(dir, 'legacy.backup.json');
  const legacyBytes = Buffer.from('{"legacy":true}\n');
  const canonicalBytes = Buffer.from('{"canonical":true}\n');
  writeFileSync(legacyPath, legacyBytes);
  return { dir, legacyPath, canonicalPath, journalPath, backupPath, legacyBytes, canonicalBytes };
}

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true });
});

function run(f: ReturnType<typeof fixture>, afterState?: (state: MigrationJournalState) => void) {
  return runJournaledMigration({
    operationId: 'app-config-v1',
    journalPath: f.journalPath,
    legacyPath: f.legacyPath,
    canonicalPath: f.canonicalPath,
    backupPath: f.backupPath,
    legacyExpectedHash: hashBytes(f.legacyBytes),
    canonicalExpectedHash: null,
    canonicalBytes: f.canonicalBytes,
    afterState
  });
}

function recoverInFreshProcess(f: ReturnType<typeof fixture>) {
  return runJournaledMigration({
    operationId: 'app-config-v1',
    journalPath: f.journalPath,
    legacyPath: f.legacyPath,
    canonicalPath: f.canonicalPath,
    backupPath: f.backupPath
  });
}

describe('harness routing migration journal', () => {
  it.each<MigrationJournalState>(['planned', 'canonical-written', 'legacy-removed', 'complete'])(
    'recovers after a crash at %s without moving backward',
    (crashState) => {
      const f = fixture();
      expect(() => run(f, (state) => {
        if (state === crashState) throw new Error(`crash:${state}`);
      })).toThrow(`crash:${crashState}`);

      const stateAfterCrash = JSON.parse(readFileSync(f.journalPath, 'utf8')).state;
      expect(stateAfterCrash).toBe(crashState);
      const observed: MigrationJournalState[] = [];
      const result = runJournaledMigration({
        operationId: 'app-config-v1',
        journalPath: f.journalPath,
        legacyPath: f.legacyPath,
        canonicalPath: f.canonicalPath,
        backupPath: f.backupPath,
        afterState: (state) => observed.push(state)
      });

      expect(result.state).toBe('complete');
      expect(readFileSync(f.canonicalPath)).toEqual(f.canonicalBytes);
      expect(existsSync(f.legacyPath)).toBe(false);
      expect(observed).not.toContain('planned');
      if (crashState === 'canonical-written') expect(observed).toEqual(['legacy-removed', 'complete']);
    }
  );

  it('may safely restart before canonical-written and moves only forward afterward', () => {
    const before = fixture();
    expect(() => run(before, (state) => {
      if (state === 'planned') throw new Error('before canonical');
    })).toThrow('before canonical');
    expect(existsSync(before.legacyPath)).toBe(true);
    expect(existsSync(before.canonicalPath)).toBe(false);
    expect(run(before).state).toBe('complete');

    const after = fixture();
    expect(() => run(after, (state) => {
      if (state === 'canonical-written') throw new Error('after canonical');
    })).toThrow('after canonical');
    writeFileSync(after.legacyPath, 'externally edited');
    expect(() => run(after)).toThrow(MigrationRepairRequiredError);
    expect(readFileSync(after.canonicalPath)).toEqual(after.canonicalBytes);
  });

  it('treats a corrupt journal as repair-required with a bounded redacted error', () => {
    const f = fixture();
    writeFileSync(f.journalPath, '{"state":"canonical-written","secret":"do-not-leak"');
    let error: unknown;
    try { run(f); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(MigrationRepairRequiredError);
    expect(String(error)).not.toContain('do-not-leak');
    expect(String(error).length).toBeLessThanOrEqual(240);
  });

  it('creates a byte-exact durable backup before canonical write', () => {
    const f = fixture();
    expect(run(f).state).toBe('complete');
    expect(readFileSync(f.backupPath)).toEqual(f.legacyBytes);
  });

  it('recovers forward in a fresh process after canonical-written using journaled bytes', () => {
    const f = fixture();
    expect(() => run(f, (state) => {
      if (state === 'canonical-written') throw new Error('process-exit');
    })).toThrow('process-exit');

    expect(recoverInFreshProcess(f).state).toBe('complete');
    expect(readFileSync(f.canonicalPath)).toEqual(f.canonicalBytes);
    expect(existsSync(f.legacyPath)).toBe(false);
  });

  it('fails closed when journaled canonical bytes are corrupt', () => {
    const f = fixture();
    expect(() => run(f, (state) => {
      if (state === 'canonical-written') throw new Error('process-exit');
    })).toThrow('process-exit');
    const journal = JSON.parse(readFileSync(f.journalPath, 'utf8'));
    journal.canonicalBytes = Buffer.from('tampered').toString('base64');
    writeFileSync(f.journalPath, `${JSON.stringify(journal, null, 2)}\n`);

    expect(() => recoverInFreshProcess(f)).toThrow(MigrationRepairRequiredError);
    expect(readFileSync(f.canonicalPath)).toEqual(f.canonicalBytes);
    expect(existsSync(f.legacyPath)).toBe(true);
  });

  it('accepts legitimate canonical writes after completion and across a fresh restart', () => {
    const editedCanonical = fixture();
    expect(run(editedCanonical).state).toBe('complete');
    writeFileSync(editedCanonical.canonicalPath, '{"later-owning-store-write":true}\n');
    expect(recoverInFreshProcess(editedCanonical)).toEqual({ state: 'complete' });
    expect(readFileSync(editedCanonical.canonicalPath, 'utf8')).toBe('{"later-owning-store-write":true}\n');
  });

  it('requires a canonical target and absent legacy before accepting complete', () => {

    const missingCanonical = fixture();
    expect(run(missingCanonical).state).toBe('complete');
    rmSync(missingCanonical.canonicalPath);
    expect(() => recoverInFreshProcess(missingCanonical)).toThrow(MigrationRepairRequiredError);

    const restoredLegacy = fixture();
    expect(run(restoredLegacy).state).toBe('complete');
    writeFileSync(restoredLegacy.legacyPath, restoredLegacy.legacyBytes);
    expect(() => recoverInFreshProcess(restoredLegacy)).toThrow(MigrationRepairRequiredError);
    expect(readFileSync(restoredLegacy.legacyPath)).toEqual(restoredLegacy.legacyBytes);
  });
});
