import type { PeerLink, PeerLinkDiagnostic } from '@zana-ai/zcc-server-contract';

const span = (ms: number | null | undefined): string => {
  if (ms === null || ms === undefined) return 'n/a';
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s}s`;
  if (s < 5400) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
};

/** Plain-text support report for Settings → Peers. No keys, codes, ports or routes. */
export function formatPeerDiagnostics(links: PeerLink[], diagnostics: PeerLinkDiagnostic[], now: Date = new Date()): string {
  const lines = [`Peers diagnostics ${now.toISOString()}`, `links: ${links.length}`];
  for (const link of links) {
    const d = diagnostics.find((item) => item.peerInstanceId === link.peerInstanceId);
    lines.push('', `${link.peerName} [${link.peerInstanceId ?? 'unclaimed'}]`,
      `  link: ${link.state}${link.reason ? ` (${link.reason})` : ''}; ${link.connected ? 'connected' : 'not connected'}${link.paused ? '; paused' : ''}; used by ${link.uses.map((u) => u.pluginId).join(', ') || 'nothing'}`);
    if (!d) { lines.push('  connection: no live detail (not an enrolled link, or not started)'); continue; }
    lines.push(`  connection: ${d.state}${d.reason ? ` (${d.reason})` : ''}; role ${d.role}; phase ${d.phase}; ssh side ${d.side}; retries ${d.retries}`,
      `  forwarder: ${d.forwarderBlocked === null ? 'ok' : `BLOCKED: ${d.forwarderBlocked}`}`,
      `  tunnel: ${d.tunnel ? `${d.tunnel.up ? 'up' : `down ${span(d.tunnel.downForMs)}`}${d.tunnel.failure ? `; failure ${d.tunnel.failure}` : ''}` : 'none'}`,
      `  session: ${d.session ? `${d.session.connected ? `open ${span(d.session.openForMs)}` : `down ${span(d.session.downForMs)}`}` : 'none'}`);
  }
  return lines.join('\n');
}
