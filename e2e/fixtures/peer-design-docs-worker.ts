import type { ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import { DesignDocStore } from '../../plugins/design-docs/src/server/store.js';
import { DesignDocSyncStore } from '../../plugins/design-docs/src/server/sync-store.js';
import { DesignDocPeerService } from '../../plugins/design-docs/src/server/peer-service.js';
import { transferQuery, type PeerTransfer } from '../../plugins/design-docs/src/server/peer-protocol.js';
import { peerBlobHash } from '../../plugins/design-docs/src/server/peer-protocol.js';
import { setTimeout as yieldTimers } from 'node:timers/promises';

/** Real DD projection/apply code; only fixture setup and sender orchestration are synthetic. */
export default function setup(api: ZccPluginApi): void {
  const db = api.storage.database();
  let sync!: DesignDocSyncStore;
  const store = new DesignDocStore(db, { onMutation: mutation => sync.recordLocalMutation(mutation) });
  sync = new DesignDocSyncStore(db);
  const service = new DesignDocPeerService(sync);
  service.register(api);
  const actor = { kind: 'user' as const, label: 'Fixture', threadId: null };
  let docId: string;
  api.rpc.method('configure', (args: any) => {
    sync.initialize(args.scope, args.replicaId);
    sync.setGroup(args.scope, 'fixture-group', args.members);
    return service.status();
  });
  api.rpc.method('prepare', async (args: any) => {
    const files = Array.from({ length: 12 }, (_, index) => index === 11 ? {
      path: 'asset.png', content: Buffer.alloc(2 * 1024 * 1024, 255).toString('base64'), encoding: 'base64' as const
    } : { path: index === 0 ? 'README.md' : `file-${index}.md`, content: String.fromCharCode(65 + index).repeat(2 * 1024 * 1024) });
    if (!docId) docId = store.create({ title: 'Maximum worker fence', status: 'approved', files }, actor).id;
    else store.writeFile(docId, { path: 'README.md', content: 'Z'.repeat(2 * 1024 * 1024) }, actor);
    // Let overdue heartbeat timers run between completed fixture transactions.
    await yieldTimers(0);
    const local = sync.localRepository()!;
    const intent = sync.freezeManual().find(intent => intent.frozenHead === sync.head(local.repoId, docId))!;
    await yieldTimers(0);
    return { docId, transfer: service.createTransfer(intent, args.grantEpoch) };
  });
  api.rpc.method('chunk', (args: any) => sync.outgoingChunk(args.transfer as PeerTransfer, args.blobHash, args.index));
  api.rpc.method('send', (args: any) => api.sdk.peers.call(args.peerId, args.method, args.body, { scope: args.scope, timeoutMs: 30_000 }));
  api.rpc.method('inspect', (args: any) => {
    const query = transferQuery(args.transfer);
    const files = db.prepare('SELECT path, content, encoding, size FROM doc_files WHERE doc_id = ? ORDER BY path').all(args.docId) as any[];
    return { bytes: files.reduce((sum, file) => sum + file.size, 0),
      files: files.map(file => ({ path: file.path, hash: peerBlobHash(Buffer.from(file.content, file.encoding === 'base64' ? 'base64' : 'utf8')) })),
      head: sync.head(query.repoId, args.docId), receipt: sync.checkpoint(query.repoId, query.senderReplicaId, query.sessionId, query.scopeHash),
      staged: db.prepare("SELECT COUNT(*) AS n FROM sync_transfer_chunks WHERE direction = 'in'").get() };
  });
}
