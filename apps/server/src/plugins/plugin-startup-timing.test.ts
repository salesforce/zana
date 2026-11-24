import { describe, expect, it } from 'vitest';
import { createPluginStartupTimer, PLUGIN_STARTUP_SLOW_STEP_MS } from './plugin-startup-timing.js';

function harness() {
  let clock = 0;
  const warnings: string[] = [];
  const infos: string[] = [];
  const timer = createPluginStartupTimer({
    now: () => clock,
    warn: (message) => warnings.push(message),
    info: (message) => infos.push(message)
  });
  return { timer, warnings, infos, advance: (ms: number) => { clock += ms; } };
}

describe('createPluginStartupTimer', () => {
  it('warns only for a step at or over the slow limit and returns the step result', async () => {
    const { timer, warnings, advance } = harness();
    await expect(timer.step('fast', async () => { advance(PLUGIN_STARTUP_SLOW_STEP_MS - 1); return 1; })).resolves.toBe(1);
    expect(warnings).toEqual([]);
    await timer.step('load salesforce', async () => { advance(PLUGIN_STARTUP_SLOW_STEP_MS); });
    expect(warnings).toEqual([`[plugins] slow startup step load salesforce took ${PLUGIN_STARTUP_SLOW_STEP_MS}ms`]);
  });

  it('records a step that throws and rethrows its error', async () => {
    const { timer, warnings, advance } = harness();
    await expect(timer.step('boom', async () => { advance(6000); throw new Error('nope'); })).rejects.toThrow('nope');
    expect(warnings).toEqual(['[plugins] slow startup step boom took 6000ms']);
  });

  it('logs the total with the three slowest steps', async () => {
    const { timer, infos, advance } = harness();
    for (const [label, ms] of [['a', 10], ['b', 300], ['c', 20], ['d', 200]] as const) {
      await timer.step(label, async () => { advance(ms); });
    }
    timer.finish();
    expect(infos).toEqual(['[plugins] startup finished in 530ms (slowest: b 300ms, d 200ms, c 20ms)']);
  });

  it('logs a bare total when no step ran, using the default clock and console', () => {
    const { timer, infos } = harness();
    timer.finish();
    expect(infos).toEqual(['[plugins] startup finished in 0ms']);
    expect(() => createPluginStartupTimer().finish()).not.toThrow();
  });

  it.each(['failed', 'cancelled'] as const)('labels a startup that %s', async (outcome) => {
    const { timer, infos, advance } = harness();
    await timer.step('a', async () => { advance(40); });
    timer.finish(outcome);
    expect(infos).toEqual([`[plugins] startup ${outcome} in 40ms (slowest: a 40ms)`]);
  });
});
