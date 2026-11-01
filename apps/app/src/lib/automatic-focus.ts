/** Background updates may fill an empty focus slot, but must not take it away. */
export function canAutomaticallyFocus(target: HTMLElement): boolean {
  const document = target.ownerDocument;
  const active = document.activeElement;
  return !active || active === document.body || active === document.documentElement
    || target.contains(active) || active.contains(target);
}
