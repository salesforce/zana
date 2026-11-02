import { expect, it } from 'vitest';
import { GUIDE_CONTENT } from './guidesContent.js';

it('explains the installed-plugin submission path and review before sending', () => {
  expect(GUIDE_CONTENT['create-extension']).toContain('More plugin actions → Submit to');
  expect(GUIDE_CONTENT['create-extension']).toContain('submit-a-plugin');
  expect(GUIDE_CONTENT['create-extension']).toContain('Review it and send it');
  expect(GUIDE_CONTENT['create-extension']).toContain('approval after preparing the work');
});

it('points the Personas guide at the Squads start guide', () => {
  expect(GUIDE_CONTENT.personas).toContain('## 3. Start using Squads');
  expect(GUIDE_CONTENT.personas).toContain('https://zana-ide.com/docs/squads-start/');
  expect(GUIDE_CONTENT.personas).toContain('five built-in Squads');
});
