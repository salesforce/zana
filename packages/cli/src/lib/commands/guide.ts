import { textResult, jsonResult, type CliResult } from '../cli-result.js';
import { renderGuide, GUIDE_CHAPTERS } from '../guide-chapters.js';

export async function runGuideCommand(
  chapter: string | undefined,
  json: boolean
): Promise<CliResult> {
  const rendered = renderGuide(chapter);
  if (rendered.id === 'unknown') {
    return { exitCode: 2, stdout: '', stderr: `Error: ${rendered.content}` };
  }
  if (json) {
    return jsonResult(chapter ? rendered : { overview: rendered.content, chapters: GUIDE_CHAPTERS.map((row) => row.id) });
  }
  return textResult(rendered.content);
}
