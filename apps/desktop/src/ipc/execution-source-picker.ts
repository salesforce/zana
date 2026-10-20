import { stat } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_MAX_ENTRIES = 32;

export interface SourcePickerProject {
  id: string;
  path: string;
  remote?: unknown;
}

export interface SourcePickerFolders {
  defaultPathFor(project: SourcePickerProject): Promise<string | undefined>;
  remember(projectId: string, pickedFilePaths: string[]): void;
}

async function statIsDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Per-project "last folder" memory for the execution source picker, so the
 * native dialog opens in the Project (or where the user last picked from for
 * it) instead of the last folder used anywhere. In-memory and LRU-capped.
 */
export function createSourcePickerFolders(
  options: { maxEntries?: number; isDirectory?: (path: string) => Promise<boolean> } = {}
): SourcePickerFolders {
  const maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
  const isDirectory = options.isDirectory ?? statIsDirectory;
  const folders = new Map<string, string>();

  const check = async (target: string): Promise<boolean> => {
    try {
      return await isDirectory(target);
    } catch {
      return false;
    }
  };

  return {
    async defaultPathFor(project) {
      const remembered = folders.get(project.id);
      if (remembered !== undefined) {
        folders.delete(project.id);
        folders.set(project.id, remembered);
        if (await check(remembered)) return remembered;
      }
      if (!project.remote && project.path && (await check(project.path))) return project.path;
      return undefined;
    },
    remember(projectId, pickedFilePaths) {
      const first = pickedFilePaths[0];
      if (!first) return;
      folders.delete(projectId);
      folders.set(projectId, path.dirname(first));
      while (folders.size > maxEntries) {
        const oldest = folders.keys().next().value;
        if (oldest === undefined) break;
        folders.delete(oldest);
      }
    }
  };
}

export function sourcePickerDialogOptions(defaultPath: string | undefined) {
  return {
    title: 'Add execution sources',
    properties: ['openFile', 'multiSelections', 'showHiddenFiles'] as Array<'openFile' | 'multiSelections' | 'showHiddenFiles'>,
    ...(defaultPath ? { defaultPath } : {})
  };
}
