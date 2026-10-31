import type { EditorSelection } from '@zana-ai/zcc-plugin-sdk/app';

/** Only show source lines when the rendered passage maps unambiguously. */
export function passageContext(path: string, source: string, text: string): EditorSelection {
  const selection: EditorSelection = { version: 1, path, text };
  const offset = source.indexOf(text);
  if (offset < 0 || source.indexOf(text, offset + 1) >= 0) return selection;
  const startLine = source.slice(0, offset).split('\n').length;
  return { ...selection, startLine, endLine: startLine + text.split('\n').length - 1 };
}
