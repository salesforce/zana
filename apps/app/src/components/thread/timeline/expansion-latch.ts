export type ManualExpansionOverride = boolean | null;

export function resolveExpansionLatch(args: {
  expandable: boolean;
  forceExpanded?: boolean;
  autoExpanded?: boolean;
  terminalAutoExpanded?: boolean;
  terminalLatch?: boolean;
  manualOverride?: ManualExpansionOverride;
}): boolean {
  if (!args.expandable) return false;
  if (args.forceExpanded) return true;
  if (args.manualOverride !== null && args.manualOverride !== undefined) {
    return args.manualOverride;
  }
  return Boolean(args.autoExpanded || args.terminalAutoExpanded || args.terminalLatch);
}
