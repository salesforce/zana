import { fleetKindLabel, type FleetKind } from './fleet-item.js';

export function FleetKindChip({ kind }: { kind: FleetKind }) {
  return (
    <span className={`fleet-kind-chip fleet-kind-${kind}`} data-testid="fleet-kind-chip" data-kind={kind}>
      {fleetKindLabel(kind)}
    </span>
  );
}
