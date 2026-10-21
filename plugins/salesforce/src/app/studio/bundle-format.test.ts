import { describe, expect, it } from 'vitest';
import { agentSummary, fileRole, groupAgents, highlight, HIGHLIGHT_LIMIT, type SourceLang } from './bundle-format.js';

const join = (source: string, lang: SourceLang) => highlight(source, lang).map(token => token.text).join('');
const kinds = (source: string, lang: SourceLang) => highlight(source, lang).filter(token => token.kind).map(token => `${token.kind}:${token.text}`);

describe('groupAgents', () => {
  it('folds three or more numbered agents in place of the first, in numeric order', () => {
    expect(groupAgents(['x/Help.agent', 'x/V_26.agent', 'x/Other_1.agent', 'x/V_9.agent', 'x/V_100.agent', 'x/Other_2.agent'])).toEqual([
      { kind: 'one', agent: { path: 'x/Help.agent', label: 'Help' } },
      { kind: 'series', prefix: 'V_', first: '9', last: '100', agents: [
        { path: 'x/V_9.agent', label: 'V_9', suffix: '9' }, { path: 'x/V_26.agent', label: 'V_26', suffix: '26' }, { path: 'x/V_100.agent', label: 'V_100', suffix: '100' }] },
      { kind: 'one', agent: { path: 'x/Other_1.agent', label: 'Other_1' } },
      { kind: 'one', agent: { path: 'x/Other_2.agent', label: 'Other_2' } }
    ]);
  });
  it('keeps names that are only a number, and handles no agents', () => {
    expect(groupAgents(['1.agent', '2.agent', '3.agent']).map(group => group.kind)).toEqual(['one', 'one', 'one']);
    expect(groupAgents([])).toEqual([]);
  });
});

describe('fileRole', () => {
  it('names the bundle files by role and keeps other names', () => {
    expect(fileRole('lwc/card/card.html', 'card')).toEqual({ label: 'template', ext: 'HTML', lang: 'markup' });
    expect(fileRole('lwc/card/card.js', 'card')).toEqual({ label: 'controller', ext: 'JS', lang: 'script' });
    expect(fileRole('lwc/card/card.ts', 'card')).toEqual({ label: 'controller', ext: 'TS', lang: 'script' });
    expect(fileRole('lwc/card/card.css', 'card')).toEqual({ label: 'styles', ext: 'CSS', lang: 'style' });
    expect(fileRole('lwc/card/card.js-meta.xml', 'card')).toEqual({ label: 'meta', ext: 'XML', lang: 'markup' });
    expect(fileRole('lwc/card/labels.json', 'card')).toEqual({ label: 'labels.json', ext: 'JSON', lang: 'script' });
    expect(fileRole('lwc/card/notes.md', 'card')).toEqual({ label: 'notes.md', ext: 'MD', lang: 'plain' });
    expect(fileRole('LICENSE', 'card')).toEqual({ label: 'LICENSE', ext: '', lang: 'plain' });
  });
});

describe('highlight', () => {
  it('marks tags, attributes, strings, bindings and comments in markup', () => {
    const source = '<!-- c -->\n<p class="a" onclick={go}>{title}</p><br/>';
    expect(join(source, 'markup')).toBe(source);
    expect(kinds(source, 'markup')).toEqual(['comment:<!-- c -->', 'tag:<p', 'attr: class', 'string:"a"', 'attr: onclick', 'expr:{go}', 'tag:>', 'expr:{title}', 'tag:</p', 'tag:>', 'tag:<br', 'tag:/>']);
  });
  it('marks comments, strings and keywords in scripts', () => {
    const source = "import x from 'y'; // hi\n/* a */ const s = `t`;";
    expect(join(source, 'script')).toBe(source);
    expect(kinds(source, 'script')).toEqual(['keyword:import', 'keyword:from', "string:'y'", 'comment:// hi', 'comment:/* a */', 'keyword:const', 'string:`t`']);
  });
  it('marks comments and strings in styles, without treating a URL as a comment', () => {
    const source = '/* x */ a { background: url(http://e.com/i.png); content: "q"; }';
    expect(join(source, 'style')).toBe(source);
    expect(kinds(source, 'style')).toEqual(['comment:/* x */', 'string:"q"']);
  });
  it('leaves plain and large files as one token', () => {
    expect(highlight('<p>', 'plain')).toEqual([{ text: '<p>' }]);
    const big = '<p>'.repeat(HIGHLIGHT_LIMIT);
    expect(highlight(big, 'markup')).toEqual([{ text: big }]);
    expect(highlight('', 'script')).toEqual([]);
  });
});

describe('agentSummary', () => {
  it('folds series and counts what is past the limit', () => {
    const paths = ['x/Help.agent', ...[1, 2, 3].map(n => `x/V_${n}.agent`), 'x/A.agent', 'x/B.agent'];
    expect(agentSummary(paths)).toBe('Help, V_1–3 (3), A, B');
    expect(agentSummary(paths, 1)).toBe('Help and 5 more');
  });
});
