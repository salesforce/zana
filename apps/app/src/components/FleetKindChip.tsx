import { fleetKindLabel, type FleetKind } from './fleet-item.js';

export function FleetKindChip({ kind, label }: { kind: FleetKind; label?: string }) {
  return (
    <span className={`fleet-kind-chip fleet-kind-${kind}`} data-testid="fleet-kind-chip" data-kind={kind}>
      {label ?? fleetKindLabel(kind)}
    </span>
  );
}
