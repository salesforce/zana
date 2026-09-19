import { createHash } from 'node:crypto';
import type { HarnessInteractionEvent } from '@zcc/harness-sdk';

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512;
}

// PermissionRequest omits tool_use_id. Its canonical tool input is also included
// in PostToolUse; hash it so neither commands nor MCP arguments live in the tracker.
function canonical(value: unknown, depth = 0): string {
  if (depth > 32) throw new Error('hook input is too deep');
  if (Array.isArray(value)) return `[${value.map((v) => canonical(v, depth + 1)).join(',')}]`;
  const object = record(value);
  if (object) return `{${Object.keys(object).sort().map((key) =>
    `${JSON.stringify(key)}:${canonical(object[key], depth + 1)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function codexInteractionHook(body: string): HarnessInteractionEvent | null {
  try {
    const event = record(JSON.parse(body));
    if (!event) return null;
    if (event.hook_event_name === 'Interrupt') return { kind: 'interrupted' };
    if (!identifier(event.turn_id) || !identifier(event.tool_name)) return null;
    const callKey = identifier(event.tool_use_id)
      ? `call:${event.turn_id}:${event.tool_use_id}` : null;
    if (event.hook_event_name === 'PreToolUse') return null;
    if (event.hook_event_name !== 'PermissionRequest' && event.hook_event_name !== 'PostToolUse') return null;
    const input = record(event.tool_input);
    if (!input) return null;
    // Shell/edit approval adds a description; completion uses the same command.
    const identity = (event.tool_name === 'Bash' || event.tool_name === 'apply_patch')
      && typeof input.command === 'string' ? { command: input.command } : input;
    const digest = createHash('sha256').update(canonical(identity)).digest('hex');
    const approvalKey = `approval:${event.turn_id}:${event.tool_name}:${digest}`;
    return event.hook_event_name === 'PermissionRequest'
      ? { kind: 'requested', key: approvalKey }
      : { kind: 'resolved', keys: [approvalKey] };
  } catch {
    return null;
  }
}
