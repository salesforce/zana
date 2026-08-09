/**
 * Synthetic lifecycle-conformance fixture (NOT a seeded/shipped extension).
 *
 * A minimal MainModule declaring all four lifecycle verbs so the W1-8 net can,
 * once the lifecycle-conformance harness lands (W1-4/5/6/7), assert the host
 * fires setup/teardown per-activation and onInstall/onUninstall exactly-once on
 * an explicit install/uninstall. It records each call onto `globalThis` so a
 * test driver can read the ordering without a real utilityProcess. Until that
 * harness lands the behavioral assertions are `.skip`; discovery of THIS
 * manifest is asserted LIVE (proves the pipeline accepts a lifecycle-declaring
 * manifest without a source edit).
 */
function record(hook) {
  const g = globalThis;
  g.__conformanceLifecycle ??= [];
  g.__conformanceLifecycle.push(hook);
}

export default {
  setup(_ctx) {
    record('setup');
  },
  teardown() {
    record('teardown');
  },
  onInstall(_ctx) {
    record('onInstall');
  },
  onUninstall(_ctx) {
    record('onUninstall');
  }
};
