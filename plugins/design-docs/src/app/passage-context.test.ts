import { expect, it } from 'vitest';
import { passageContext } from './passage-context.js';

it('captures the selected text and source lines when the match is unique', () => {
  expect(passageContext('README.md', '# Title\n\nFirst line\nSecond line\n', 'First line\nSecond line')).toEqual({
    version: 1, path: 'README.md', text: 'First line\nSecond line', startLine: 3, endLine: 4
  });
});

it('keeps rendered and repeated passages without inventing a source range', () => {
  expect(passageContext('page.html', '<p>One <b>two</b></p>', 'One two')).toEqual({ version: 1, path: 'page.html', text: 'One two' });
  expect(passageContext('README.md', 'Same\nSame', 'Same')).toEqual({ version: 1, path: 'README.md', text: 'Same' });
});
