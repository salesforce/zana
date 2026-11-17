import { describe, expect, it } from 'vitest';
import { apiErrorResumeSupport, registeredAdapters } from '../registry.js';

// #649 A1/F1: the declaration must be one a code path can honour, for every registered adapter.
const NON_HOOK_SOURCES_EXIST = false; // no SDK-event or screen-scan API-error path exists yet
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

  it('accepts sdk-events and screen-scan only once a source for them exists', () => {
    for (const adapter of adapters) {
      const signal = adapter.status!.apiErrorSignal;
      if (signal === 'sdk-events' || signal === 'screen-scan') {
        expect(NON_HOOK_SOURCES_EXIST, `${adapter.descriptor.id} declares ${signal} with no source`).toBe(true);
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
