/** Pick the first numbered copy name not already used after trim/case folding. */
export function uniqueCopyName(sourceName: string, names: Iterable<string>): string {
  const taken = new Set([...names].map((name) => name.trim().toLocaleLowerCase()));
  const base = sourceName.trim();
  let number = 1;
  while (taken.has(`${base} ${number}`.trim().toLocaleLowerCase())) number += 1;
  return `${base} ${number}`;
}
