/**
 * C3 — `DocsList` + `ArtifactCard` sub-tab tests.
 *
 * Zero-DOM strategy (matches C5 `ProfilesView.test.tsx`): `renderToStaticMarkup`
 * for rendered OUTPUT (title, type label, excerpt, linked-ticket pluralization,
 * tag chip cap + `+N` overflow, empty state), and a recursive element walker
 * (`flatten`) to find the card's `onClick` / `onKeyDown` and invoke them so we
 * assert `onOpen` fires with the artifact on click AND on Enter/Space.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode
} from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ZanaArtifact } from '@shared/zana-types';
import { DocsList } from '../DocsList';

function mkArtifact(over: Partial<ZanaArtifact> = {}): ZanaArtifact {
  return {
    id: 'a1',
    title: 'Doc',
    content: '',
    tags: [],
    linkedTickets: [],
    ...over
  };
}

const markup = (el: ReactElement) => renderToStaticMarkup(el);

/** Recursively expand a function-component tree into a flat element list. */
function flatten(node: ReactNode): ReactElement[] {
  const out: ReactElement[] = [];
  const visit = (n: ReactNode) => {
    if (Array.isArray(n)) {
      n.forEach(visit);
      return;
    }
    if (!isValidElement(n)) return;
    out.push(n);
    const el = n as ReactElement<{ children?: ReactNode }>;
    const type = el.type;
    if (typeof type === 'function') {
      const rendered = (type as (p: unknown) => ReactNode)(el.props);
      visit(rendered);
    } else {
      visit(el.props?.children);
    }
  };
  visit(node);
  return out;
}

describe('DocsList + ArtifactCard', () => {
  it('renders one card per artifact with title and type label', () => {
    const artifacts = [
      mkArtifact({ id: 'a', title: 'Design Doc', type: 'design-doc', content: 'Hello world' }),
      mkArtifact({ id: 'b', title: 'Spec', type: 'requirement-spec' })
    ];
    const html = markup(createElement(DocsList, { artifacts, onOpen: () => {} }));
    expect(html).toContain('Design Doc');
    expect(html).toContain('design-doc');
    expect(html).toContain('Spec');
    expect(html).toContain('requirement-spec');
  });

  it('excerpt strips fenced code blocks and heading hashes', () => {
    const content = '# Heading\n\nReal prose here.\n\n```js\nconst secret = 1;\n```';
    const html = markup(
      createElement(DocsList, { artifacts: [mkArtifact({ content })], onOpen: () => {} })
    );
    expect(html).toContain('Real prose here.');
    // Heading hash markers and fenced-code contents must NOT survive.
    expect(html).not.toContain('# Heading');
    expect(html).not.toContain('const secret');
  });

  it('pluralizes the linked-ticket count (1 ticket vs 2 tickets)', () => {
    const one = markup(
      createElement(DocsList, {
        artifacts: [mkArtifact({ linkedTickets: ['t1'] })],
        onOpen: () => {}
      })
    );
    expect(one).toContain('1 linked ticket');
    expect(one).not.toContain('1 linked tickets');

    const two = markup(
      createElement(DocsList, {
        artifacts: [mkArtifact({ linkedTickets: ['t1', 't2'] })],
        onOpen: () => {}
      })
    );
    expect(two).toContain('2 linked tickets');
  });

  it('caps tag chips at 5 and shows a +N overflow chip', () => {
    const tags = ['t1', 't2', 't3', 't4', 't5', 't6', 't7'];
    const html = markup(
      createElement(DocsList, { artifacts: [mkArtifact({ tags })], onOpen: () => {} })
    );
    expect(html).toContain('t5');
    expect(html).not.toContain('>t6'); // 6th tag is not rendered as a chip
    expect(html).toContain('+2'); // 7 - 5
  });

  it('renders the No docs. empty state when there are none', () => {
    const html = markup(createElement(DocsList, { artifacts: [], onOpen: () => {} }));
    expect(html).toContain('gus-column-empty');
    expect(html).toContain('No docs.');
  });

  it('click and Enter/Space call onOpen with the artifact', () => {
    const onOpen = vi.fn();
    const artifact = mkArtifact({ id: 'doc-9', title: 'Nine' });
    const els = flatten(createElement(DocsList, { artifacts: [artifact], onOpen }));
    const card = els.find(
      (e) =>
        typeof e.type === 'string' &&
        (e.props as { className?: string }).className === 'zana-doc-item'
    );
    expect(card).toBeTruthy();
    const props = card!.props as {
      onClick: () => void;
      onKeyDown: (e: { key: string; preventDefault: () => void }) => void;
    };

    props.onClick();
    expect(onOpen).toHaveBeenCalledWith(artifact);

    const prevent = vi.fn();
    props.onKeyDown({ key: 'Enter', preventDefault: prevent });
    props.onKeyDown({ key: ' ', preventDefault: prevent });
    expect(onOpen).toHaveBeenCalledTimes(3);
    expect(prevent).toHaveBeenCalledTimes(2);

    // A non-activating key does nothing.
    props.onKeyDown({ key: 'a', preventDefault: prevent });
    expect(onOpen).toHaveBeenCalledTimes(3);
  });
});
