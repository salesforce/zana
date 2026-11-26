import { describe, expect, it } from 'vitest';
import { apiErrorResumeSupport, registeredAdapters } from '../registry.js';
import { API_ERROR_FAILURE_FIXTURES } from './fixtures/api-error-failures.js';

// #649 A1/F1: the declaration must be one a code path can honour, for every registered adapter.
const EVENT_NAMES = ['Stop', 'StopFailure', 'Notification', 'PermissionRequest', 'PostToolUse', 'PreToolUse', 'SessionStart', 'UserPromptSubmit'];
const ERROR_FIELDS = { error: 'rate_limit', error_details: '429 too many requests', last_assistant_message: 'API Error: 529' };

const payloads = (): string[] => [
  JSON.stringify({ hook_event_name: 'StopFailure', ...ERROR_FIELDS }),
  ...EVENT_NAMES.map((name) => JSON.stringify({ hook_event_name: name, turn_id: 't1', ...ERROR_FIELDS })),
  '{not json',
  ''
];

describe('API-error signal contract across registered adapters', () => {
  const adapters = registeredAdapters().map(({ adapter }) => adapter).filter((adapter) => adapter.status);

  const nonHook = adapters.filter((a) => a.status!.apiErrorSignal === 'sdk-events' || a.status!.apiErrorSignal === 'screen-scan');

  it('requires a producer and a failing-turn fixture for every sdk-events and screen-scan adapter', () => {
    for (const adapter of nonHook) {
      const id = adapter.descriptor.id;
      expect(adapter.status!.apiErrorProducer, `${id} declares ${adapter.status!.apiErrorSignal} with no producer`).toBeDefined();
      expect(API_ERROR_FAILURE_FIXTURES[id], `${id} has no failing-turn fixture`).toBeTypeOf('function');
    }
  });

  it('has no fixture for an adapter that does not use a non-hook source', () => {
    const ids = new Set(nonHook.map((a) => a.descriptor.id));
    for (const id of Object.keys(API_ERROR_FAILURE_FIXTURES)) expect(ids.has(id as never), `stale fixture ${id}`).toBe(true);
  });

  it('each non-hook producer reports a failed turn and stays silent on a good one', async () => {
    for (const adapter of nonHook) {
      const producer = adapter.status!.apiErrorProducer!;
      for (const failed of [true, false]) {
        const fixture = API_ERROR_FAILURE_FIXTURES[adapter.descriptor.id]!();
        const { session, cleanup } = fixture.prepare();
        try {
          const marker = await producer.markTurnStart(session);
          if (failed) fixture.appendFailedTurn(); else fixture.appendSuccessfulTurn();
          const event = await producer.check(session, marker);
          if (failed) expect(event?.kind, adapter.descriptor.id).toBe('api-error-stop');
          else expect(event, adapter.descriptor.id).toBeNull();
        } finally {
          producer.release(session.id);
          cleanup();
        }
      }
    }
  });

  it('keeps an adapter with a producer from also claiming hook-sourced errors', () => {
    for (const adapter of nonHook.filter((a) => a.status!.interactionHook)) {
      for (const body of payloads()) {
        expect(adapter.status!.interactionHook!(body)?.kind, `${adapter.descriptor.id}: ${body}`).not.toBe('api-error-stop');
      }
    }
  });

  it('requires an interactionHook for every hook declaration', () => {
    for (const adapter of adapters.filter((a) => a.status!.apiErrorSignal === 'hook')) {
      expect(adapter.status!.interactionHook, adapter.descriptor.id).toBeTypeOf('function');
    }
  });

  it("never lets a 'none' adapter's hook return api-error-stop", () => {
    for (const adapter of adapters.filter((a) => a.status!.apiErrorSignal === 'none' && a.status!.interactionHook)) {
      for (const body of payloads()) {
        expect(adapter.status!.interactionHook!(body)?.kind, `${adapter.descriptor.id}: ${body}`).not.toBe('api-error-stop');
      }
    }
  });

  it('keeps every hook-declaring adapter supported and every none adapter unsupported', () => {
    for (const adapter of adapters) {
      expect(apiErrorResumeSupport(adapter)).toBe(adapter.status!.apiErrorSignal === 'none' ? 'unsupported' : 'supported');
    }
  });

  it('treats a status with no apiErrorSignal (older or malformed adapter) as unsupported', () => {
    expect(apiErrorResumeSupport({ status: {} })).toBe('unsupported');
    expect(apiErrorResumeSupport({ status: { apiErrorSignal: undefined } })).toBe('unsupported');
  });
});
