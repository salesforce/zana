/**
 * Test-only fault injection for built-Electron E2E runs.
 *
 * `__ZCC_TEST_FAULTS__` is inlined by the build only when the E2E runner builds the app, so in a
 * production build the guard is the literal `false`, the bundler drops the branch, and the
 * environment variable is never read. Even in an E2E build nothing fires unless `ZCC_TEST_FAULT`
 * names the fault.
 */
declare const __ZCC_TEST_FAULTS__: boolean | undefined;

export function testFaultActive(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (typeof __ZCC_TEST_FAULTS__ === 'undefined' || !__ZCC_TEST_FAULTS__) return false;
  return env.ZCC_TEST_FAULT === name;
}
