/**
 * Strip trailing `/` characters with a linear scan. Replaces `/\/+$/`, which
 * CodeQL flags as polynomial on long runs of slashes (js/polynomial-redos).
 */
export function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
  return end === value.length ? value : value.slice(0, end);
}
