import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' } });

test('desktop skill policy persists each load state and rejects unsupported owners', async ({ app }) => {
  const skill = await app.window.evaluate(async () =>
    (await (await fetch('/api/v1/skills/native-capabilities')).json()).skills.find((entry: { id: string; name: string }) => entry.id.startsWith('zcc:') && entry.name === 'zana-ui-proposals')
  );
  expect(skill, 'the shipped UI proposal skill is available without personal configuration').toBeTruthy();
  expect(skill.toggle.state).toBe('on');

  for (const state of ['manual', 'off', 'on'] as const) {
    const result = await app.window.evaluate(async ({ skill, state }) => {
      const saved = await window.cc.skills.setState([{ id: skill.id, name: skill.name, state }]);
      const listed = (await (await fetch('/api/v1/skills/native-capabilities')).json()).skills.find((entry: { id: string }) => entry.id === skill.id);
      return { saved, state: listed?.toggle.state };
    }, { skill: skill!, state });
    expect(result).toEqual({ saved: { ok: true, applied: 1, rejected: 0 }, state });
  }

  const rejected = await app.window.evaluate(() => window.cc.skills.setState([
    { id: 'unsupported:skill', name: 'skill', state: 'off' }
  ]));
  expect(rejected).toEqual({ ok: false, applied: 0, rejected: 1 });
  const retained = await app.window.evaluate(async id =>
    (await (await fetch('/api/v1/skills/native-capabilities')).json()).skills.find((entry: { id: string }) => entry.id === id)?.toggle.state,
  skill!.id);
  expect(retained).toBe('on');
});
