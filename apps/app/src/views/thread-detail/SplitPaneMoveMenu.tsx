import { Move } from 'lucide-react';
import { PopoverPicklist } from '../../components/ui/PopoverPicklist.js';
import type { SplitSide } from '../../lib/split-layout/types.js';

const SIDES = [
  { value: 'left', label: 'Move pane left' },
  { value: 'right', label: 'Move pane right' },
  { value: 'top', label: 'Move pane above' },
  { value: 'bottom', label: 'Move pane below' }
] as const;

export function SplitPaneMoveMenu({ onMoveToSide }: { onMoveToSide: (side: SplitSide) => void }) {
  return (
    <PopoverPicklist<SplitSide>
      ariaLabel="Move pane"
      title="Move pane"
      value=""
      placeholder=""
      options={SIDES}
      onChange={onMoveToSide}
      searchable={false}
      triggerClassName="icon-btn split-pane-move-trigger"
      triggerIcon={<Move size={14} aria-hidden />}
    />
  );
}
