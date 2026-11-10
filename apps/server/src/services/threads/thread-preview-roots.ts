import { join } from 'node:path';
import { projectAttachmentDir } from '../projects/attachments.js';

/** Server-owned preview roots; threadId must come from the registered thread row. */
export function threadLocalPreviewRoots(dataDir: string, projectId?: string | null, threadId?: string): string[] {
  return [
    ...(threadId ? [join(dataDir, 'thread-storage', threadId)] : []),
    ...(projectId ? [projectAttachmentDir(dataDir, projectId)] : []),
    join(dataDir, 'artifacts')
  ];
}
