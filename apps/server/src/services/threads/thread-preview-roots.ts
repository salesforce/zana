import { join } from 'node:path';
import { projectAttachmentDir } from '../projects/attachments.js';

/** Server-owned preview roots; never accept these roots from the renderer. */
export function threadLocalPreviewRoots(dataDir: string, projectId?: string | null): string[] {
  return [
    ...(projectId ? [projectAttachmentDir(dataDir, projectId)] : []),
    join(dataDir, 'artifacts')
  ];
}
