import {
  pendingInteractionSchema,
  type PendingInteraction
} from '@zana-ai/zcc-domain/thread-runtime';
import type { PendingInteractionRow } from '@zana-ai/zcc-db';
import { ThreadCreateError } from '../../http/thread-create.js';

export class PendingInteractionSerializationError extends ThreadCreateError {
  readonly interactionId: string;
  readonly field: 'payload' | 'resolution';

  constructor(interactionId: string, field: 'payload' | 'resolution') {
    super(500, 'internal_error', `Stored pending interaction ${field} is invalid`);
    this.interactionId = interactionId;
    this.field = field;
  }
}

function parseStoredJson(row: PendingInteractionRow, field: 'payload' | 'resolution'): unknown {
  const value = field === 'payload' ? row.payload : row.resolution;
  if (value === null) {
    throw new PendingInteractionSerializationError(row.id, field);
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new PendingInteractionSerializationError(row.id, field);
  }
}

export function toPendingInteraction(row: PendingInteractionRow): PendingInteraction {
  const payload = parseStoredJson(row, 'payload');
  const resolution = row.resolution === null ? null : parseStoredJson(row, 'resolution');
  try {
    return pendingInteractionSchema.parse({
      id: row.id,
      threadId: row.threadId,
      turnId: row.turnId,
      ...(row.originKind === 'provider'
        ? {
            providerId: row.providerId,
            providerThreadId: row.providerThreadId,
            providerRequestId: row.providerRequestId
          }
        : {}),
      origin:
        row.originKind === 'provider'
          ? {
              kind: 'provider',
              providerId: row.providerId,
              providerThreadId: row.providerThreadId,
              providerRequestId: row.providerRequestId
            }
          : {
              kind: 'plugin',
              pluginId: row.pluginId,
              rendererId: row.rendererId
            },
      status: row.status,
      payload,
      resolution,
      statusReason: row.statusReason,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      resolvedAt: row.resolvedAt
    });
  } catch {
    throw new PendingInteractionSerializationError(row.id, 'payload');
  }
}
