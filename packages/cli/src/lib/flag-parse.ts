export function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i !== -1 && args[i + 1] !== undefined && !args[i + 1].startsWith('--')) {
    return args[i + 1] === '' ? undefined : args[i + 1];
  }
  const eq = args.find((a) => a.startsWith(`${flag}=`));
  if (!eq) return undefined;
  const v = eq.slice(flag.length + 1);
  return v === '' ? undefined : v;
}

export function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

export function stripFlags(args: string[], valueFlags: string[], boolFlags: string[]): string[] {
  const skip = new Set<number>();
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i]!;
    if (boolFlags.includes(token)) {
      skip.add(i);
      continue;
    }
    if (valueFlags.includes(token)) {
      skip.add(i);
      if (args[i + 1] !== undefined && !args[i + 1].startsWith('--')) skip.add(i + 1);
      continue;
    }
    if (valueFlags.some((flag) => token.startsWith(`${flag}=`))) skip.add(i);
  }
  return args.filter((_, i) => !skip.has(i));
}

export function splitSentinel(args: string[]): { head: string[]; tail: string[] } {
  const idx = args.indexOf('--');
  if (idx === -1) return { head: args, tail: [] };
  return { head: args.slice(0, idx), tail: args.slice(idx + 1) };
}
