/**
 * The pinned visualizer (1.7.0) fits the full layout but then centers its main
 * branch. Wide scheduled/fault branches consequently fall outside the canvas.
 * Use its existing full-layout centering fallback instead. Fail the build on
 * upstream drift so an upgrade cannot silently restore the clipping bug.
 */
export function centerFullFlowLayout(html: string): string {
  const spine = /contentCenterX:([\w$]+)==null\?void 0:\1\.spineCenterX/g;
  if ([...html.matchAll(spine)].length !== 1) throw Error('The Flow visualizer centering adapter needs review for this SDK bundle.');
  return html.replace(spine, 'contentCenterX:void 0');
}
