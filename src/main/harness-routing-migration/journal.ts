import type { DurableWriteFileSystem } from './storage.js';
import {
  atomicDurableWrite,
  durableRemove,
  hashBytes,
  MigrationCasError,
  readRawFile
} from './storage.js';

export type MigrationJournalState = 'planned' | 'canonical-written' | 'legacy-removed' | 'complete';

export class MigrationRepairRequiredError extends Error {}

export interface JournaledMigrationOptions {
  operationId: string;
  journalPath: string;
  legacyPath: string;
  canonicalPath: string;
  backupPath: string;
  legacyExpectedHash?: string;
  canonicalExpectedHash?: string | null;
  canonicalBytes?: Buffer;
  afterState?: (state: MigrationJournalState) => void;
  fs?: DurableWriteFileSystem;
}

interface MigrationJournal {
  version: 2;
  operationId: string;
  state: MigrationJournalState;
  legacyPath: string;
  canonicalPath: string;
  backupPath: string;
  legacyExpectedHash: string;
  canonicalExpectedHash: string | null;
  canonicalHash: string;
  canonicalBytes: string;
}

const STATES: readonly MigrationJournalState[] = [
  'planned',
  'canonical-written',
  'legacy-removed',
  'complete'
];

function parseJournal(bytes: Buffer, options: JournaledMigrationOptions): MigrationJournal {
  try {
    const parsed = JSON.parse(bytes.toString('utf8')) as Partial<MigrationJournal>;
    if (parsed.version !== 2 || parsed.operationId !== options.operationId ||
        !STATES.includes(parsed.state as MigrationJournalState) ||
        parsed.legacyPath !== options.legacyPath || parsed.canonicalPath !== options.canonicalPath ||
        parsed.backupPath !== options.backupPath || typeof parsed.legacyExpectedHash !== 'string' ||
        (parsed.canonicalExpectedHash !== null && typeof parsed.canonicalExpectedHash !== 'string') ||
        typeof parsed.canonicalHash !== 'string' || typeof parsed.canonicalBytes !== 'string') {
      throw new Error('invalid');
    }
    const canonicalBytes = Buffer.from(parsed.canonicalBytes, 'base64');
    if (canonicalBytes.toString('base64') !== parsed.canonicalBytes || hashBytes(canonicalBytes) !== parsed.canonicalHash) {
      throw new Error('invalid');
    }
    return parsed as MigrationJournal;
  } catch {
    throw new MigrationRepairRequiredError('journal-corrupt');
  }
}

function writeJournal(options: JournaledMigrationOptions, journal: MigrationJournal, state: MigrationJournalState): void {
  const bytes = Buffer.from(`${JSON.stringify({ ...journal, state }, null, 2)}\n`);
  atomicDurableWrite(options.journalPath, bytes, { fs: options.fs });
  options.afterState?.(state);
}

function requireHash(bytes: Buffer | null, expected: string, repair: boolean): Buffer {
  if (bytes === null || hashBytes(bytes) !== expected) {
    if (repair) throw new MigrationRepairRequiredError('external-edit');
    throw new MigrationCasError();
  }
  return bytes;
}

export function runJournaledMigration(options: JournaledMigrationOptions): { state: MigrationJournalState } {
  const rawJournal = readRawFile(options.journalPath, options.fs);
  let journal: MigrationJournal;
  let state: MigrationJournalState | undefined;
  if (rawJournal !== null) {
    journal = parseJournal(rawJournal, options);
    state = journal.state;
  } else {
    if (options.legacyExpectedHash === undefined || options.canonicalExpectedHash === undefined || options.canonicalBytes === undefined) {
      throw new MigrationRepairRequiredError('journal-missing-plan');
    }
    journal = {
      version: 2,
      operationId: options.operationId,
      state: 'planned',
      legacyPath: options.legacyPath,
      canonicalPath: options.canonicalPath,
      backupPath: options.backupPath,
      legacyExpectedHash: options.legacyExpectedHash,
      canonicalExpectedHash: options.canonicalExpectedHash,
      canonicalHash: hashBytes(options.canonicalBytes),
      canonicalBytes: options.canonicalBytes.toString('base64')
    };
  }
  const canonicalBytes = Buffer.from(journal.canonicalBytes, 'base64');

  if (state === 'complete') {
    // Completion retires the source sidecar, not the canonical store. The owning
    // store may legitimately rewrite canonical bytes after migration, so its
    // migration-era hash is no longer an invariant. A restored sidecar still
    // means legacy state was resurrected and must fail closed.
    if (readRawFile(options.legacyPath, options.fs) !== null ||
        readRawFile(options.canonicalPath, options.fs) === null) {
      throw new MigrationRepairRequiredError('complete-mismatch');
    }
    return { state };
  }

  try {
    if (state === undefined) {
      const legacy = requireHash(readRawFile(options.legacyPath, options.fs), journal.legacyExpectedHash, false);
      atomicDurableWrite(options.backupPath, legacy, { expectedHash: null, fs: options.fs });
      writeJournal(options, journal, 'planned');
      state = 'planned';
    }

    if (state === 'planned') {
      requireHash(readRawFile(options.legacyPath, options.fs), journal.legacyExpectedHash, false);
      const existingCanonical = readRawFile(options.canonicalPath, options.fs);
      if (existingCanonical === null || hashBytes(existingCanonical) !== journal.canonicalHash) {
        atomicDurableWrite(options.canonicalPath, canonicalBytes, {
          expectedHash: journal.canonicalExpectedHash,
          fs: options.fs
        });
      }
      writeJournal(options, journal, 'canonical-written');
      state = 'canonical-written';
    }

    if (state === 'canonical-written') {
      const canonical = readRawFile(options.canonicalPath, options.fs);
      if (canonical === null || hashBytes(canonical) !== journal.canonicalHash) {
        throw new MigrationRepairRequiredError('canonical-mismatch');
      }
      const legacy = readRawFile(options.legacyPath, options.fs);
      if (legacy !== null) {
        if (hashBytes(legacy) !== journal.legacyExpectedHash) {
          throw new MigrationRepairRequiredError('external-edit');
        }
        durableRemove(options.legacyPath, { expectedHash: journal.legacyExpectedHash, fs: options.fs });
      }
      writeJournal(options, journal, 'legacy-removed');
      state = 'legacy-removed';
    }

    if (state === 'legacy-removed') {
      if (readRawFile(options.legacyPath, options.fs) !== null) {
        throw new MigrationRepairRequiredError('external-edit');
      }
      requireHash(readRawFile(options.canonicalPath, options.fs), journal.canonicalHash, true);
      writeJournal(options, journal, 'complete');
      state = 'complete';
    }
    return { state };
  } catch (error) {
    if (error instanceof MigrationCasError && state !== undefined) {
      throw new MigrationRepairRequiredError('external-edit');
    }
    throw error;
  }
}
