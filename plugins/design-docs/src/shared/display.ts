/** Small display helpers shared by the agent-facing text and the UI. */
import type { DocActor } from './contract.js';

/**
 * How agent-facing text names who did something. The UI labels the user
 * "You", which an agent would read as itself, so users are "the user" here.
 */
export function actorLabel(actor: DocActor): string {
  return actor.kind === 'agent' ? `agent "${actor.label}"` : 'the user';
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MiB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KiB`;
  return `${bytes} B`;
}

export function relativeTime(at: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(at).toISOString().slice(0, 10);
}
