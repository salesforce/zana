export function runStartupDependencyDoctor(
  e2eLaunch: boolean,
  check: () => Promise<void>,
  onError: (error: unknown) => void
): void {
  if (e2eLaunch) return;
  void check().catch(onError);
}
