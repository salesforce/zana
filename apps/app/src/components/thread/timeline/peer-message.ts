import { parseAgentMessageEnvelope } from '@zana-ai/zcc-thread-view';
import type { MessageSource } from '@zana-ai/zcc-domain/thread-runtime';

/** Only hide the transport header when it matches the recorded sender. */
export function peerMessageDisplay(row: { role: string; initiator?: string; senderThreadId?: string | null; text: string | null }) {
  if (row.role !== 'user' || row.initiator !== 'agent' || !row.senderThreadId || !row.text) return null;
  const envelope = parseAgentMessageEnvelope(row.text);
  if (!envelope || envelope.senderThreadId !== row.senderThreadId) return null;
  const rest = row.text.slice(envelope.bodyStart);
  const name = /^Peer: ([^\r\n]{1,200})\n/u.exec(rest);
  const cli = row.text.slice(0, envelope.bodyStart).includes('; kind:cli-agent');
  return { label: name?.[1] ?? row.senderThreadId, kind: cli ? 'cli-agent' : 'thread',
    text: name ? rest.slice(name[0].length) : rest,
    href: cli ? null : `/threads/${encodeURIComponent(row.senderThreadId)}` };
}

/** A peer message in the timeline is labelled exactly like a bot message. */
export function peerMessageSource(peer: NonNullable<ReturnType<typeof peerMessageDisplay>>, senderThreadId: string): MessageSource {
  return peer.kind === 'cli-agent'
    ? { pluginId: 'sdk', kind: 'thread', label: peer.label, detail: 'CLI Agent' }
    : { pluginId: 'sdk', kind: 'thread', label: peer.label, threadId: senderThreadId, detail: 'messaged' };
}
