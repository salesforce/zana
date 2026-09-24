export function sqliteAbiCachePath(abi: string, options: { cacheRoot: string; packageVersion: string; platform?: string; arch?: string }): string;
export function sqliteNativeBinding(requireFrom?: NodeRequire, exists?: (path: string) => boolean, runtime?: Pick<NodeJS.Process, 'versions' | 'platform' | 'arch'>): string | undefined;
