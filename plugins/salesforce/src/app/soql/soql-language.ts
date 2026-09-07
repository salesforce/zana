export const SOQL_KEYWORDS = [
  'SELECT',
  'FROM',
  'WHERE',
  'AND',
  'OR',
  'NOT',
  'IN',
  'LIKE',
  'ORDER',
  'BY',
  'GROUP',
  'HAVING',
  'LIMIT',
  'OFFSET',
  'ASC',
  'DESC',
  'NULLS',
  'FIRST',
  'LAST',
  'TYPEOF',
  'WHEN',
  'THEN',
  'ELSE',
  'END',
  'USING',
  'SCOPE',
  'FOR',
  'VIEW',
  'REFERENCE',
  'UPDATE',
  'TRACKING',
  'VIEWSTAT',
  'ALL',
  'ROWS',
  'COUNT',
  'COUNT_DISTINCT',
  'SUM',
  'AVG',
  'MIN',
  'MAX',
  'TOLABEL',
  'CONVERTCURRENCY',
  'DISTANCE',
  'GEOLOCATION',
  'INCLUDES',
  'EXCLUDES',
  'TRUE',
  'FALSE',
  'NULL'
] as const;

export const SOQL_LANGUAGE_ID = 'soql';

export function soqlKeywordSet(): Set<string> {
  return new Set(SOQL_KEYWORDS.map((word) => word.toUpperCase()));
}

export type SoqlClause = 'select' | 'from' | 'where' | 'order' | 'group' | 'unknown';

export function clauseAtCursor(soql: string, cursor: number): SoqlClause {
  const before = soql.slice(0, cursor).toUpperCase();
  const last = Math.max(
    before.lastIndexOf('SELECT'),
    before.lastIndexOf('FROM'),
    before.lastIndexOf('WHERE'),
    before.lastIndexOf('ORDER BY'),
    before.lastIndexOf('GROUP BY')
  );
  if (last === -1) return 'unknown';
  if (before.lastIndexOf('SELECT') === last) return 'select';
  if (before.lastIndexOf('FROM') === last) return 'from';
  if (before.lastIndexOf('WHERE') === last) return 'where';
  if (before.lastIndexOf('ORDER BY') === last) return 'order';
  if (before.lastIndexOf('GROUP BY') === last) return 'group';
  return 'unknown';
}

export function tokenBeforeCursor(soql: string, cursor: number): string {
  const before = soql.slice(0, cursor);
  const match = before.match(/[A-Za-z_][\w.]*$/);
  return match?.[0] ?? '';
}

export function registerSoqlMonacoLanguage(monaco: {
  languages: {
    register(lang: { id: string }): void;
    setMonarchTokensProvider(id: string, provider: unknown): void;
    setLanguageConfiguration(id: string, config: unknown): void;
  };
}): void {
  monaco.languages.register({ id: SOQL_LANGUAGE_ID });
  monaco.languages.setLanguageConfiguration(SOQL_LANGUAGE_ID, {
    comments: { lineComment: '--', blockComment: ['/*', '*/'] },
    brackets: [
      ['(', ')'],
      ['[', ']']
    ],
    autoClosingPairs: [
      { open: '(', close: ')' },
      { open: "'", close: "'" }
    ]
  });
  monaco.languages.setMonarchTokensProvider(SOQL_LANGUAGE_ID, {
    ignoreCase: true,
    keywords: [...SOQL_KEYWORDS],
    tokenizer: {
      root: [
        [/--.*$/, 'comment'],
        [/\/\*/, 'comment', '@comment'],
        [/'([^'\\]|\\.)*'/, 'string'],
        [/[0-9]+/, 'number'],
        [/[a-zA-Z_][\w]*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }]
      ],
      comment: [
        [/\*\//, 'comment', '@pop'],
        [/./, 'comment']
      ]
    }
  });
}
