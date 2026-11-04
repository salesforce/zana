import { describe, expect, it } from 'vitest';
import { SQUAD_GOAL_MAX_CHARS, SQUAD_LIMIT_COUNTER_FROM } from '@zana-ai/zcc-domain/squad-proposal';
import { squadTextLimitView } from '../team-composer-limit.js';

describe('squadTextLimitView', () => {
  it('stays hidden below 90% of the limit', () => {
    expect(squadTextLimitView(SQUAD_LIMIT_COUNTER_FROM - 1, SQUAD_GOAL_MAX_CHARS)).toMatchObject({ show: false, over: false });
  });

  it('appears at 1,844 characters', () => {
    expect(squadTextLimitView(1844, 2048)).toMatchObject({ show: true, over: false });
  });

  it('is shown but not over at exactly the limit', () => {
    expect(squadTextLimitView(2048, 2048)).toMatchObject({ show: true, over: false, label: '2,048 / 2,048' });
  });

  it('is over one character past the limit', () => {
    expect(squadTextLimitView(2049, 2048)).toEqual({ show: true, over: true, label: '2,049 / 2,048' });
  });
});
