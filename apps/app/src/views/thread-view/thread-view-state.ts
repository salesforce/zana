import { threadIdFromPath } from '../../lib/route-paths.js';

/** The window title: the thread, then its project, then the app. */
export function threadViewDocumentTitle(threadTitle: string | null | undefined, projectName: string | null | undefined, base: string): string {
  return [threadTitle?.trim() || 'Agent', projectName, base].filter(Boolean).join(' — ');
}

/**
 * A thread window has no shell to navigate in. When its thread links
 * elsewhere (a fork, the list after an archive), the main window shows that
 * path; a path that is not a thread also means this thread is done here.
 */
export function threadViewForward(
  pathname: string,
  homePathname: string
): { path: string; closeWindow: boolean } | null {
  if (pathname === homePathname) return null;
  return { path: pathname, closeWindow: threadIdFromPath(pathname) === undefined };
}
