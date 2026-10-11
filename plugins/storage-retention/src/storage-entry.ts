import { randomUUID } from "node:crypto";
import path from "node:path";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const THREAD_ENTRY = new RegExp(`^${UUID}$`, "i");
const TRASH_ENTRY = new RegExp(`^\\.zcc-trash-${UUID}-${UUID}$`, "i");
const TRASH_PREFIX = ".zcc-trash-";

/** A per-thread storage directory is named after the thread's UUID. */
export const isThreadEntry = (name: string) => THREAD_ENTRY.test(name);
/** A directory this plugin renamed aside and is still deleting. */
export const isTrashEntry = (name: string) => TRASH_ENTRY.test(name);
/**
 * The only names the plugin ever measures or removes under the thread-storage
 * root. The root also holds daemon directories (`model-list`, `provider-health`)
 * that must never match.
 */
export const isStorageEntry = (name: string) =>
  isThreadEntry(name) || isTrashEntry(name);

export function assertStorageEntry(rootPath: string, name: string): void {
  if (!path.isAbsolute(rootPath) || !isStorageEntry(name))
    throw new Error("Invalid storage entry");
}

export function trashNameFor(name: string, id: string = randomUUID()): string {
  if (!isThreadEntry(name)) throw new Error("Invalid storage entry");
  return `${TRASH_PREFIX}${name}-${id}`;
}

/** True only when `candidate` is strictly beneath `root` once both are normalized. */
export function insideRoot(root: string, candidate: string): boolean {
  if (!path.isAbsolute(candidate)) return false;
  const relative = path.relative(root, candidate);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}
