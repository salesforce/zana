import { describe, expect, it } from 'vitest';
import { resolveTriggeredSquadPlan } from './team-trigger-semantics.js';

const validPlan = [
  '### write: Write output <!-- executable-step -->',
  '',
  '- **Depends on:** None',
  '- **Mode:** Mutating',
  '- **Write scope:** `output.txt`',
  '- **Work:** Create output.',
  '- **Verification:** Read output.'
].join('\n');

describe('resolveTriggeredSquadPlan', () => {
  it('starts inferred objectives in freeform coordination', () => {
    expect(resolveTriggeredSquadPlan('infer', 'Inspect current state and ship fix.')).toEqual({
      coordinationMode: 'freeform'
    });
  });

  it('uses structured coordination only after a provided plan validates as a durable DAG', () => {
    expect(resolveTriggeredSquadPlan('provided', validPlan)).toMatchObject({
      coordinationMode: 'structured',
      workUnits: [{ id: 'write', files: ['output.txt'] }]
    });
  });

  it('keeps an invalid provided plan out of structured coordination and exposes its correction reason', () => {
    const invalidPlan = '### write: Write output <!-- executable-step -->\n\n- **Mode:** Mutating\n- **Work:** Create output.\n- **Verification:** Read output.';

    expect(resolveTriggeredSquadPlan('provided', invalidPlan)).toEqual({
      coordinationMode: 'freeform',
      planError: expect.any(String)
    });
  });

  it('detects invalid provided plans using parser marker whitespace and case grammar', () => {
    const invalidPlan = '  ### write: Write output <!--  EXECUTABLE-STEP  -->\n\n- **Mode:** Mutating\n- **Work:** Create output.\n- **Verification:** Read output.';

    expect(resolveTriggeredSquadPlan('provided', invalidPlan)).toEqual({
      coordinationMode: 'freeform',
      planError: expect.any(String)
    });
  });
});
