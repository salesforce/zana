export function parseGithubMentionId(itemId, fallbackRepo) {
  const raw = String(itemId ?? '').trim();
  const withRepo = raw.match(/^([\w.-]+\/[\w.-]+)#(\d+)$/);
  if (withRepo) return { repo: withRepo[1], number: Number(withRepo[2]) };
  const bare = raw.match(/^#?(\d+)$/);
  if (bare && fallbackRepo) return { repo: fallbackRepo, number: Number(bare[1]) };
  return null;
}

export function githubMentionItemsFromList(kind, query, repo, entries) {
  const needle = query.trim().toLowerCase().replace(/^#/, '');
  const noun = kind === 'pr' ? 'PR' : 'Issue';
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => {
      const number = String(entry?.number ?? '');
      const title = String(entry?.title ?? '').toLowerCase();
      return !needle || number === needle || title.includes(needle);
    })
    .slice(0, 20)
    .map((entry) => ({
      id: `${repo}#${entry.number}`,
      label: `${noun} ${repo}#${entry.number}: ${entry.title ?? ''}`.trim(),
      insertText: `@${repo}#${entry.number}`
    }));
}

export function githubMentionFallbackItems(kind, query, repo) {
  const number = query.trim().replace(/^#/, '');
  if (!repo || !/^\d+$/.test(number)) return [];
  const noun = kind === 'pr' ? 'PR' : 'Issue';
  return [{
    id: `${repo}#${number}`,
    label: `${noun} ${repo}#${number}`,
    insertText: `@${repo}#${number}`
  }];
}

export function formatGithubMentionContext(args) {
  const noun = args.kind === 'pr' ? 'pull request' : 'issue';
  const heading = args.title
    ? `# GitHub ${noun} ${args.repo}#${args.number}: ${args.title}`
    : `# GitHub ${noun} ${args.repo}#${args.number}`;
  const meta = [args.state ? `State: ${args.state}` : null, args.author ? `Author: ${args.author}` : null]
    .filter(Boolean)
    .join(' · ');
  const lines = [heading, ''];
  if (meta) lines.push(meta);
  if (args.url) lines.push(`URL: ${args.url}`);
  if (meta || args.url) lines.push('');
  if (args.body) {
    lines.push(args.body, '');
  } else if (args.detailError) {
    lines.push(`Could not load details (${args.detailError}).`, '');
  }
  lines.push(
    `For full comments run: gh ${args.kind === 'pr' ? 'pr' : 'issue'} view ${args.number} -R ${args.repo} --comments`
  );
  return lines.join('\n');
}
