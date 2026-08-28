import { computeNotifyDelivery } from './notify.js';
import { statusPriority, type MonitoredPr, type PrMonitorSettings, type PrRollupStatus, type PrStatusDelta } from './types.js';

const STATUS_LABELS: Record<PrRollupStatus, string> = {
  pending: 'Pending',
  failed: 'Failing',
  conflict: 'Merge conflict',
  yellow: 'Merge blocked',
  'review-required': 'Review required',
  integrating: 'Merging',
  green: 'All checks passing',
  'closed-merged': 'Merged',
  'closed-abandoned': 'Closed'
};

function statusLabel(status: PrRollupStatus): string {
  return STATUS_LABELS[status] ?? status;
}

function escapeMarkdownText(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|]/g, '\\$&');
}

function safeMarkdownUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
  } catch {
    return '';
  }
  return url.replace(/[)\s]/g, encodeURIComponent);
}

export function isInterestingDelta(delta: PrStatusDelta): boolean {
  const worsened = statusPriority(delta.newStatus) > statusPriority(delta.oldStatus);
  return (
    delta.newStatus === 'failed' ||
    delta.newStatus === 'conflict' ||
    delta.newStatus === 'yellow' ||
    delta.newStatus === 'green' ||
    delta.newStatus === 'closed-merged' ||
    delta.newStatus === 'closed-abandoned' ||
    worsened
  );
}

export function inboxCommentForDelta(delta: PrStatusDelta): string {
  const repo = escapeMarkdownText(delta.pr.repo);
  const title = escapeMarkdownText(delta.pr.title);
  const href = safeMarkdownUrl(delta.pr.url);
  const titleLine = href ? `[${title}](${href})` : title;
  return (
    `**${repo}#${delta.pr.number}** — ${statusLabel(delta.oldStatus)} → ` +
    `**${statusLabel(delta.newStatus)}**\n\n${titleLine}`
  );
}

export function inboxDeliveriesForDeltas(
  deltas: PrStatusDelta[],
  settings: PrMonitorSettings
): Array<{ projectId: string; comments: string; pr: MonitoredPr }> {
  const out: Array<{ projectId: string; comments: string; pr: MonitoredPr }> = [];
  for (const delta of deltas) {
    if (!isInterestingDelta(delta)) continue;
    const delivery = computeNotifyDelivery(delta.pr, settings);
    if (!delivery.inbox || !delta.pr.projectId) continue;
    out.push({
      projectId: delta.pr.projectId,
      comments: inboxCommentForDelta(delta),
      pr: delta.pr
    });
  }
  return out;
}
