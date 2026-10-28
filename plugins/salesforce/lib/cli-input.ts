import { resolveUnderRoot } from './dx-project.js';
import type { SalesforceDeps } from './types.js';

/** JSON envelopes stay bounded even when their source field uses the editor's 10 MB limit. */
export const CLI_INPUT_FILE_MAX = 16 * 1024 * 1024;

export function readCliInput(argv: string[], projectRoot: string | undefined, deps: SalesforceDeps): unknown {
  const inline = argv.indexOf('--input');
  const file = argv.indexOf('--input-file');
  if (inline !== -1 && file !== -1) throw Error('Use either --input or --input-file, not both.');
  if (argv.filter(arg => arg === '--input' || arg === '--input-file').length > 1) throw Error('Provide one input option.');
  if (file !== -1) {
    const candidate = argv[file + 1];
    if (!candidate || candidate.startsWith('--')) throw Error('Provide a project-relative JSON path after --input-file.');
    if (!projectRoot) throw Error('--input-file requires a registered project.');
    const path = resolveUnderRoot(projectRoot, candidate, deps.realpath);
    if (!path || deps.stat(path) !== 'file') throw Error('Input file must be a JSON file inside the registered project.');
    if (!deps.readFileBounded) throw Error('Bounded input-file reading is unavailable.');
    const text = deps.readFileBounded(path, CLI_INPUT_FILE_MAX);
    if (text === null) throw Error('Could not read the input file.');
    try { return JSON.parse(text); }
    catch { throw Error('Input file must contain valid JSON.'); }
  }
  if (inline === -1) return {};
  try { return JSON.parse(argv[inline + 1] ?? ''); }
  catch { throw Error('Provide valid JSON after --input.'); }
}
