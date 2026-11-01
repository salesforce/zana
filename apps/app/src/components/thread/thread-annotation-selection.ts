import {
  MAX_CONTEXT_REFERENCE_TEXT,
  parseContextReference,
  type ContextReference,
} from '@zana-ai/zcc-domain/context-reference';

/** Read one message's selection; UI controls and neighboring messages are never quoted. */
export function readThreadAnnotation(
  root: HTMLElement,
  threadId: string,
  selection: Selection | null,
): { reference: ContextReference; rect: DOMRect } | null {
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1)
    return null;
  const element = (node: Node | null) =>
    node instanceof Element ? node : node?.parentElement;
  const prose = element(selection.anchorNode)?.closest<HTMLElement>(
    '[data-thread-annotation-prose]',
  );
  if (
    !prose ||
    !root.contains(prose) ||
    !prose.contains(selection.focusNode) ||
    [selection.anchorNode, selection.focusNode].some((node) =>
      element(node)?.closest(
        'input,textarea,button,a,[contenteditable="true"]',
      ),
    )
  )
    return null;
  const text = selection.toString();
  if (!text.trim() || text.length > MAX_CONTEXT_REFERENCE_TEXT) return null;
  const reference = parseContextReference({
    version: 1,
    label: text.trim().replace(/\s+/g, ' ').slice(0, 60),
    text,
    source: {
      kind: 'thread',
      threadId,
      messageId: prose.dataset.messageId,
      sourceSeqEnd: Number(prose.dataset.sourceSeqEnd),
    },
  });
  return reference
    ? { reference, rect: selection.getRangeAt(0).getBoundingClientRect() }
    : null;
}
