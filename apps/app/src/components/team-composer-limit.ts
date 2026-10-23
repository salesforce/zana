import { formatSquadChars } from '@zana-ai/zcc-domain/squad-proposal';

export interface SquadTextLimitView {
  show: boolean;
  over: boolean;
  label: string;
}

/** Counter state for a Squad text field: appears at 90% of the limit, flags when over. */
export function squadTextLimitView(length: number, limit: number): SquadTextLimitView {
  return {
    show: length >= Math.ceil(limit * 0.9),
    over: length > limit,
    label: `${formatSquadChars(length)} / ${formatSquadChars(limit)}`
  };
}
