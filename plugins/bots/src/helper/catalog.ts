import bundled from './catalog.generated.json' with { type: 'json' };

export interface HelperGuide {
  id: string;
  guide: string;
  title: string;
  text: string;
  url: string;
  plugin?: string;
}

const commonWords = new Set([
  'and', 'are', 'can', 'does', 'for', 'from', 'have', 'how', 'the', 'this', 'what', 'when',
  'where', 'which', 'will', 'with', 'you', 'your', 'zana'
]);

const searchAliases: Record<string, string> = {
  bots: 'bot', projects: 'project', providers: 'provider', scheduled: 'schedule',
  scheduler: 'schedule', schedules: 'schedule', scheduling: 'schedule'
};

function words(value: string): Set<string> {
  const tokens = value.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
  return new Set(tokens.filter(word => !commonWords.has(word)).map(word => Object.hasOwn(searchAliases, word) ? searchAliases[word] : word));
}

export function browseGuides(entries: readonly HelperGuide[], query: string): HelperGuide[] {
  const terms = [...words(query)];
  if (!terms.length) return [...entries];
  return entries
    .map(guide => {
      const heading = words(guide.title);
      const section = words(guide.guide);
      const content = words(guide.text);
      let score = 0;
      for (const word of terms) {
        score += heading.has(word) ? 8 : section.has(word) ? 4 : content.has(word) ? 1 : 0;
      }
      return { guide, score };
    })
    .filter(({ score }) => score > 0)
    .sort((first, second) => second.score - first.score)
    .map(({ guide }) => guide);
}

export const helpCatalog: { version: string; entries: HelperGuide[] } = bundled;
