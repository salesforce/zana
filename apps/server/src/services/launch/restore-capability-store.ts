import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import type { CreateTerminalRequest, LaunchProfileId } from '@zana-ai/zcc-domain/product';
import { atomicDurableWrite, readRawFile } from '../harness-routing/storage.js';

export interface RestoreCapability {
  id: string;
  request: CreateTerminalRequest;
  sessionId?: string;
  sessionProfile?: LaunchProfileId;
  sessionTitle?: string;
  remoteTmuxId?: string;
  createdAt: number;
  exitedAt?: number;
}

export interface ExitedSessionIdentity {
  projectId: string;
  profile: LaunchProfileId;
  sessionId: string;
}

interface RestoreCapabilityFile {
  version: 1;
  entries: RestoreCapability[];
}

export function createRestoreCapabilityStore(opts: { filePath: string; maxEntries?: number }) {
  const maxEntries = opts.maxEntries ?? 200;
  const reservations = new Map<string, string>();

  function read(): RestoreCapabilityFile {
    const bytes = readRawFile(opts.filePath);
    if (!bytes) return { version: 1, entries: [] };
    try {
      const value = JSON.parse(bytes.toString('utf8')) as RestoreCapabilityFile;
      if (value.version !== 1 || !Array.isArray(value.entries)) throw new Error('invalid shape');
      return value;
    } catch (error) {
      throw new Error(`corrupt restore capability store: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function write(state: RestoreCapabilityFile): void {
    mkdirSync(dirname(opts.filePath), { recursive: true });
    state.entries = state.entries.slice(-maxEntries);
    atomicDurableWrite(opts.filePath, Buffer.from(JSON.stringify(state)));
  }

  function put(entry: RestoreCapability): void {
    if (reservations.has(entry.id)) return;
    const state = read();
    state.entries = state.entries.filter((candidate) => candidate.id !== entry.id);
    state.entries.push(structuredClone(entry));
    write(state);
  }

  function reserve(id: string): { capability: RestoreCapability; reservationId: string } | undefined {
    if (!id) return undefined;
    if (reservations.has(id)) return undefined;
    const state = read();
    const entry = state.entries.find((candidate) => candidate.id === id);
    if (!entry) return undefined;
    const reservationId = randomUUID();
    reservations.set(id, reservationId);
    return { capability: structuredClone(entry), reservationId };
  }

  function consume(id: string, reservationId: string): boolean {
    if (reservations.get(id) !== reservationId) return false;
    const state = read();
    const entries = state.entries.filter((entry) => entry.id !== id);
    if (entries.length === state.entries.length) {
      reservations.delete(id);
      return false;
    }
    write({ ...state, entries });
    reservations.delete(id);
    return true;
  }

  function release(id: string, reservationId: string): boolean {
    if (reservations.get(id) !== reservationId) return false;
    reservations.delete(id);
    return true;
  }

  function remove(id: string): void {
    reservations.delete(id);
    const state = read();
    const entries = state.entries.filter((entry) => entry.id !== id);
    if (entries.length === state.entries.length) return;
    write({ ...state, entries });
  }

  function removeSession(sessionId: string): boolean {
    const state = read();
    const removedIds = state.entries
      .filter((entry) => entry.sessionId === sessionId)
      .map((entry) => entry.id);
    if (removedIds.length === 0) return false;
    for (const id of removedIds) reservations.delete(id);
    write({ ...state, entries: state.entries.filter((entry) => entry.sessionId !== sessionId) });
    return true;
  }

  function get(id: string): RestoreCapability | undefined {
    const entry = read().entries.find((candidate) => candidate.id === id);
    return entry ? structuredClone(entry) : undefined;
  }

  function list(): RestoreCapability[] {
    return structuredClone(read().entries);
  }

  function findSession(sessionId: string): RestoreCapability | undefined {
    const entry = read().entries.find((candidate) => candidate.sessionId === sessionId);
    return entry ? structuredClone(entry) : undefined;
  }

  function markExited(sessionId: string, exitedAt: number): void {
    const state = read();
    const entry = state.entries.find((candidate) => candidate.sessionId === sessionId);
    if (!entry) return;
    entry.exitedAt = exitedAt;
    write(state);
  }

  function findExitedSession(identity: ExitedSessionIdentity): RestoreCapability | undefined {
    const entry = read().entries.find((candidate) =>
      candidate.sessionId === identity.sessionId &&
      candidate.request.projectId === identity.projectId &&
      candidate.sessionProfile === identity.profile &&
      candidate.exitedAt != null &&
      !!candidate.remoteTmuxId
    );
    return entry ? structuredClone(entry) : undefined;
  }

  return { put, reserve, consume, release, remove, removeSession, get, list, findSession, markExited, findExitedSession };
}
