import { posix as path } from 'node:path';
import type { WebAdapterOptions } from '@salesforce/metadata-visualizer-web';

/** The SDK can see only an already-authorized snapshot, never the host disk. */
export function flowSnapshotFileSystem(content: string, fileName = 'Preview.flow-meta.xml'): WebAdapterOptions['fileSystem'] {
  if (!/^[A-Za-z][A-Za-z0-9_]*\.flow-meta\.xml$/.test(fileName)) throw Error('Invalid Flow filename.');
  const root = '/flow-preview';
  const file = `${root}/${fileName}`;
  const denied = () => ({ success: false as const, error: new Error('Only the selected Flow snapshot is available.') });
  return {
    separator: '/', normalizePath: path.normalize, basename: path.basename, dirname: path.dirname,
    join: path.join, extname: path.extname, parse: path.parse, relative: path.relative,
    resolve: path.resolve, isAbsolute: path.isAbsolute,
    getWorkspaceRoot: () => root,
    readFile: async candidate => candidate === file ? { success: true, data: content } : denied(),
    writeFile: async () => denied(),
    exists: async candidate => candidate === file || candidate === root,
    getMetadata: async candidate => candidate === file ? { success: true, data: { path: file, fileName, extension: '.xml' } } : denied(),
    readDirectory: async candidate => candidate === root ? { success: true, data: [{ name: fileName, isFile: true }] } : denied(),
    findFiles: async () => ({ success: true, data: [] }),
  };
}
