/** Hard limits for persisted peer-sync data and protocol packets. */
// Version 1 carried hashes only and cannot acknowledge a durable payload.
// Version 3 adds delta offers: ancestors the recipient already holds may be omitted.
export const PEER_PROTOCOL_VERSION = 3;
/** Oldest protocol still spoken; handshakes open at this version and advertise PEER_PROTOCOL_VERSION. */
export const PEER_MIN_PROTOCOL_VERSION = 2;
/** First protocol in which senders may omit ancestors known to the recipient. */
export const PEER_DELTA_PROTOCOL_VERSION = 3;
export const MAX_PEER_GROUP_MEMBERS = 8;
export const MAX_PEER_PACKET_BYTES = 512 * 1024;
export const MAX_PEER_CHUNK_BYTES = 256 * 1024;
export const MAX_PEER_SESSION_BYTES = 32 * 1024 * 1024;
/** Chunks in one missing-chunk window: a session's byte cap over the chunk size. */
export const MAX_PEER_WINDOW_CHUNKS = MAX_PEER_SESSION_BYTES / MAX_PEER_CHUNK_BYTES;
/** Frozen transfer may span several bounded missing-chunk windows. */
export const MAX_PEER_TRANSFER_BYTES = 128 * 1024 * 1024;
export const PEER_RETRY_MAX_MS = 15 * 60 * 1000;
export const PEER_STAGE_IDLE_MS = 15 * 60 * 1000;
export const MAX_PEER_SESSION_OPERATIONS = 10_000;
/** Catch-up pages stay far below the session cap so one page never monopolises a tick. */
export const MAX_PEER_PAGE_OPERATIONS = 500;
export const MAX_PENDING_PEER_INTENTS = 10_000;
export const MAX_PEER_STORED_BYTES = 256 * 1024 * 1024;
/** Counts retained (uncompacted) closures; compacted versions keep only their operation row. */
export const MAX_PEER_STORED_VERSIONS = 10_000;
/** Operation rows are never compacted, so they get their own, larger, still hard cap. */
export const MAX_PEER_STORED_OPERATIONS = 50_000;
/**
 * Deletion tombstones kept as document heads. Past the cap the oldest fully delivered ones drop their head row;
 * their operation rows (never compacted) still fence stale replays, so a pruned delete cannot resurrect.
 */
export const MAX_PEER_TOMBSTONES = 1_000;
/** Closures compacted per capacity-relief round; rounds repeat until relief or no candidates remain. */
export const PEER_COMPACTION_BATCH = 256;
export const MAX_PEER_CLOSURE_BYTES = 96 * 1024 * 1024;
export const MAX_PEER_HISTORY_ROWS = 12_500;
export const MAX_PEER_STORED_HISTORY_IDENTITIES = 100_000;
export const PEER_CALL_TIMEOUT_MS = 15_000;
export const PEER_PENDING_TICK_MS = 30_000;
export const MAX_PEER_STAGED_SESSIONS = 8;
export const MAX_PEER_SESSION_BLOBS = 20_000;
