import Database from 'better-sqlite3';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { TerminalHostBinding, TerminalHostEvent } from '@zana-ai/zcc-contracts/terminal-execution';
import type { TerminalSessionRecord } from './terminal-session-service.js';

interface TerminalSessionRow {
  session_id: string;
  launch_epoch: number;
  state: TerminalSessionRecord['state'];
  accepted: number;
  pid: number | null;
  next_sequence: number;
  expected_exit: number | null;
  host_id: string | null;
  instance_id: string | null;
  host_connection_id: string | null;
}

interface TerminalEventRow {
  payload: string;
}

export interface TerminalSessionRepository {
  getSession(sessionId: string): TerminalSessionRecord | null;
  saveSession(session: TerminalSessionRecord): void;
  deleteSession(sessionId: string): void;
  appendEvent(event: Exclude<TerminalHostEvent, { kind: 'rejected' }>): void;
  eventsSince(sessionId: string, afterSequence: number): TerminalHostEvent[];
  activateHostConnection(binding: TerminalHostBinding, expiresAt: number): void;
  isActiveHostConnection(binding: TerminalHostBinding): boolean;
  disconnectSessionsForHost(hostId: string, currentBinding: TerminalHostBinding): void;
  close(): void;
}

const MAX_EVENTS_PER_SESSION = 1_000;

/**
 * Server-owned runtime schema. Migrations are recorded in the database so a
 * packaged server can safely restart or upgrade without consulting Electron
 * memory or deriving its schema from the host daemon.
 */
export function createRuntimeDatabase(file: string): TerminalSessionRepository {
  const directory = dirname(file);
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true, mode: 0o700 });
  // Terminal event replay can include arbitrary process output. The containing
  // directory protects the database and its WAL/SHM sidecars as one unit.
  chmodSync(directory, 0o700);
  const database = new Database(file);
  chmodSync(file, 0o600);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');

  database.exec(`
    CREATE TABLE IF NOT EXISTS runtime_schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const applied = new Set(
    (database.prepare('SELECT version FROM runtime_schema_migrations').all() as Array<{ version: number }>)
      .map((row) => row.version)
  );
  if (!applied.has(1)) {
    database.transaction(() => {
      database.exec(`
        CREATE TABLE terminal_sessions (
          session_id TEXT PRIMARY KEY,
          launch_epoch INTEGER NOT NULL,
          state TEXT NOT NULL CHECK (state IN ('starting', 'running', 'exited')),
          accepted INTEGER NOT NULL CHECK (accepted IN (0, 1)),
          pid INTEGER,
          next_sequence INTEGER NOT NULL,
          expected_exit INTEGER CHECK (expected_exit IN (0, 1)),
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE terminal_events (
          ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL REFERENCES terminal_sessions(session_id) ON DELETE CASCADE,
          sequence INTEGER,
          payload TEXT NOT NULL
        );
        CREATE INDEX terminal_events_session_ordinal
          ON terminal_events(session_id, ordinal);
      `);
      database.prepare('INSERT INTO runtime_schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(1, Date.now());
    })();
  }
  if (!applied.has(2)) {
    database.transaction(() => {
      const columns = new Set(
        (database.prepare('PRAGMA table_info(terminal_sessions)').all() as Array<{ name: string }>)
          .map((column) => column.name)
      );
      database.exec(`
        CREATE TABLE runtime_hosts (
          host_id TEXT PRIMARY KEY,
          created_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL
        );
        CREATE TABLE host_connection_leases (
          host_connection_id TEXT PRIMARY KEY,
          host_id TEXT NOT NULL REFERENCES runtime_hosts(host_id) ON DELETE CASCADE,
          instance_id TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          replaced_at INTEGER,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX host_connection_leases_host_active
          ON host_connection_leases(host_id, expires_at)
          WHERE replaced_at IS NULL;
      `);
      if (!columns.has('host_id')) database.exec('ALTER TABLE terminal_sessions ADD COLUMN host_id TEXT');
      if (!columns.has('instance_id')) database.exec('ALTER TABLE terminal_sessions ADD COLUMN instance_id TEXT');
      if (!columns.has('host_connection_id')) database.exec('ALTER TABLE terminal_sessions ADD COLUMN host_connection_id TEXT');
      database.prepare('INSERT INTO runtime_schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(2, Date.now());
    })();
  }

  const getSession = database.prepare(`
    SELECT session_id, launch_epoch, state, accepted, pid, next_sequence, expected_exit,
      host_id, instance_id, host_connection_id
    FROM terminal_sessions WHERE session_id = ?
  `);
  const saveSession = database.prepare(`
    INSERT INTO terminal_sessions (
      session_id, launch_epoch, state, accepted, pid, next_sequence, expected_exit,
      host_id, instance_id, host_connection_id, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      launch_epoch = excluded.launch_epoch,
      state = excluded.state,
      accepted = excluded.accepted,
      pid = excluded.pid,
      next_sequence = excluded.next_sequence,
      expected_exit = excluded.expected_exit,
      host_id = excluded.host_id,
      instance_id = excluded.instance_id,
      host_connection_id = excluded.host_connection_id,
      updated_at = excluded.updated_at
  `);
  const appendEvent = database.prepare(`
    INSERT INTO terminal_events (session_id, sequence, payload) VALUES (?, ?, ?)
  `);
  const pruneEvents = database.prepare(`
    DELETE FROM terminal_events
    WHERE ordinal IN (
      SELECT ordinal FROM terminal_events
      WHERE session_id = ?
      ORDER BY ordinal DESC
      LIMIT -1 OFFSET ?
    )
  `);
  const deleteSession = database.prepare('DELETE FROM terminal_sessions WHERE session_id = ?');
  const eventsSince = database.prepare(`
    SELECT payload FROM terminal_events
    WHERE session_id = ?
    ORDER BY ordinal ASC
  `);
  const upsertHost = database.prepare(`
    INSERT INTO runtime_hosts (host_id, created_at, last_seen_at) VALUES (?, ?, ?)
    ON CONFLICT(host_id) DO UPDATE SET last_seen_at = excluded.last_seen_at
  `);
  const replaceHostConnection = database.prepare(`
    UPDATE host_connection_leases SET replaced_at = ?
    WHERE host_id = ? AND host_connection_id != ? AND replaced_at IS NULL
  `);
  const insertHostConnection = database.prepare(`
    INSERT INTO host_connection_leases (
      host_connection_id, host_id, instance_id, expires_at, replaced_at, created_at
    ) VALUES (?, ?, ?, ?, NULL, ?)
    ON CONFLICT(host_connection_id) DO UPDATE SET
      expires_at = excluded.expires_at,
      replaced_at = NULL
  `);
  const getActiveHostConnection = database.prepare(`
    SELECT host_connection_id FROM host_connection_leases
    WHERE host_connection_id = ? AND host_id = ? AND instance_id = ?
      AND replaced_at IS NULL AND expires_at > ?
  `);
  const disconnectSessionsForHost = database.prepare(`
    UPDATE terminal_sessions
    SET state = 'exited', expected_exit = 0, updated_at = ?
    WHERE host_id = ? AND host_connection_id != ? AND state IN ('starting', 'running')
  `);

  return {
    getSession(sessionId) {
      const row = getSession.get(sessionId) as TerminalSessionRow | undefined;
      if (!row) return null;
      return {
        sessionId: row.session_id,
        launchEpoch: row.launch_epoch,
        state: row.state,
        accepted: row.accepted === 1,
        ...(row.pid === null ? {} : { pid: row.pid }),
        nextSequence: row.next_sequence,
        ...(row.expected_exit === null ? {} : { expectedExit: row.expected_exit === 1 }),
        ...(row.host_id === null || row.instance_id === null || row.host_connection_id === null ? {} : {
          binding: {
            hostId: row.host_id,
            instanceId: row.instance_id,
            hostConnectionId: row.host_connection_id
          }
        })
      };
    },
    saveSession(session) {
      saveSession.run(
        session.sessionId,
        session.launchEpoch,
        session.state,
        session.accepted ? 1 : 0,
        session.pid ?? null,
        session.nextSequence,
        session.expectedExit === undefined ? null : session.expectedExit ? 1 : 0,
        session.binding?.hostId ?? null,
        session.binding?.instanceId ?? null,
        session.binding?.hostConnectionId ?? null,
        Date.now()
      );
    },
    deleteSession(sessionId) {
      deleteSession.run(sessionId);
    },
    appendEvent(event) {
      database.transaction(() => {
        appendEvent.run(event.sessionId, 'sequence' in event ? event.sequence : null, JSON.stringify(event));
        pruneEvents.run(event.sessionId, MAX_EVENTS_PER_SESSION);
      })();
    },
    eventsSince(sessionId, afterSequence) {
      return (eventsSince.all(sessionId) as TerminalEventRow[])
        .map((row) => JSON.parse(row.payload) as TerminalHostEvent)
        .filter((event) => !('sequence' in event) || event.sequence > afterSequence);
    },
    activateHostConnection(binding, expiresAt) {
      database.transaction(() => {
        const now = Date.now();
        upsertHost.run(binding.hostId, now, now);
        replaceHostConnection.run(now, binding.hostId, binding.hostConnectionId);
        insertHostConnection.run(
          binding.hostConnectionId,
          binding.hostId,
          binding.instanceId,
          expiresAt,
          now
        );
      })();
    },
    isActiveHostConnection(binding) {
      return getActiveHostConnection.get(
        binding.hostConnectionId,
        binding.hostId,
        binding.instanceId,
        Date.now()
      ) !== undefined;
    },
    disconnectSessionsForHost(hostId, currentBinding) {
      disconnectSessionsForHost.run(Date.now(), hostId, currentBinding.hostConnectionId);
    },
    close() {
      database.close();
    }
  };
}

export function createInMemoryTerminalSessionRepository(): TerminalSessionRepository {
  const sessions = new Map<string, TerminalSessionRecord>();
  const events = new Map<string, TerminalHostEvent[]>();
  const activeConnections = new Map<string, { binding: TerminalHostBinding; expiresAt: number }>();
  return {
    getSession(sessionId) {
      const session = sessions.get(sessionId);
      return session ? { ...session } : null;
    },
    saveSession(session) {
      sessions.set(session.sessionId, { ...session });
    },
    deleteSession(sessionId) {
      sessions.delete(sessionId);
      events.delete(sessionId);
    },
    appendEvent(event) {
      const stored = events.get(event.sessionId) ?? [];
      stored.push(event);
      // Preserve the migration lane's existing bounded replay behavior.
      while (stored.length > 1_000) stored.shift();
      events.set(event.sessionId, stored);
    },
    eventsSince(sessionId, afterSequence) {
      return (events.get(sessionId) ?? []).filter((event) =>
        !('sequence' in event) || event.sequence > afterSequence
      );
    },
    activateHostConnection(binding, expiresAt) {
      activeConnections.set(binding.hostId, { binding: { ...binding }, expiresAt });
    },
    isActiveHostConnection(binding) {
      const active = activeConnections.get(binding.hostId);
      return active !== undefined &&
        active.expiresAt > Date.now() &&
        active.binding.instanceId === binding.instanceId &&
        active.binding.hostConnectionId === binding.hostConnectionId;
    },
    disconnectSessionsForHost(hostId, currentBinding) {
      for (const [sessionId, session] of sessions) {
        if (
          session.binding?.hostId === hostId &&
          session.binding.hostConnectionId !== currentBinding.hostConnectionId &&
          (session.state === 'starting' || session.state === 'running')
        ) {
          sessions.set(sessionId, { ...session, state: 'exited', expectedExit: false });
        }
      }
    },
    close() {}
  };
}
