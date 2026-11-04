import { formatSquadChars, SQUAD_LIMIT_COUNTER_RATIO } from '@zana-ai/zcc-domain/squad-proposal';

export interface SquadTextLimitView {
  show: boolean;
  over: boolean;
  label: string;
}

/** Counter state for a Squad text field: appears from SQUAD_LIMIT_COUNTER_RATIO of the limit, flags when over. */
export function squadTextLimitView(length: number, limit: number): SquadTextLimitView {
  return {
    show: length >= Math.ceil(limit * SQUAD_LIMIT_COUNTER_RATIO),
    over: length > limit,
    label: `${formatSquadChars(length)} / ${formatSquadChars(limit)}`
  };
}
