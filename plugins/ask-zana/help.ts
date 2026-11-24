export const MAX_QUESTION_LENGTH = 2_000;

export interface Guide {
  id: string;
  title: string;
  example: string;
  summary: string;
  terms: string;
  sections: { title: string; steps: string[] }[];
  source?: { label: string; path: string };
}

const docs = 'https://github.com/salesforce/zana/blob/b0d99af05281cf8ffd44eda96a1feb5d22d39eba/docs';

export const guides: Guide[] = [
  {
    id: 'slack',
    title: 'Troubleshoot a Slack connection',
    example: 'Why won’t Slack connect?',
    summary: 'Check your linked Slack account and the workspace you authorized in Zana for Slack.',
    source: { label: 'Using Zana in Slack', path: `${docs}/slack-user-guide.md` },
    terms: 'slack oauth authorization authorize disconnected reconnect callback workspace sign in connection pairing link linked slack bot',
    sections: [
      {
        title: 'Check your Slack account',
        steps: [
          'Open Plugins → Zana for Slack → Configuration. If the plugin is disabled, enable it first.',
          'Under Connect your Slack account, check that your linked account belongs to the workspace you intend to use.',
          'If you need to connect, start the connection from that panel and complete the prompts in the intended Slack workspace.'
        ]
      },
      {
        title: 'If Zana still shows disconnected',
        steps: [
          'Return to Zana and check the connection message. If access was denied, check whether your Slack workspace requires admin approval.',
          'If the account is linked but messages do not reach Zana, confirm that this Mac is online and that the Slack request came from the linked owner account.'
        ]
      }
    ]
  },
  {
    id: 'scheduler',
    title: 'Schedule a recurring task',
    example: 'How do I schedule a weekly task?',
    summary: 'Use Scheduler to run an agent or terminal task on a schedule in a selected project.',
    terms: 'scheduler schedule scheduled scheduling recurring recurrence weekly daily monthly cron cadence repeating periodic timezone time zone interval missed skipped automation',
    sections: [
      {
        title: 'Create a weekly schedule',
        steps: [
          'Open Scheduler and select New schedule.',
          'Choose the project and the kind of run. For an agent run, write a prompt that states what each run should produce.',
          'Set the weekly cadence, or enter a cron expression for the day and time you want. Check the time zone before saving.'
        ]
      },
      {
        title: 'Check the first run',
        steps: ['Use Run now from the schedule’s menu to try it, then check its run history for the outcome.']
      }
    ]
  },
  {
    id: 'squads',
    title: 'Choose when to use a Squad',
    example: 'When should I use a Squad?',
    summary: 'Use a Squad when several agents need to coordinate distinct assignments and combine their results.',
    source: { label: 'Teams and personas guide', path: `${docs}/teams-and-personas-guide.md` },
    terms: 'squad squads teams orchestration coordinated delegation parallel agents multiple workers roles handoff planning worktree',
    sections: [
      {
        title: 'Choose the right amount of coordination',
        steps: [
          'Use a Squad for work you can divide into clear assignments, such as investigating distinct parts of a codebase and combining the findings.',
          'Use New Chat for a question or change one agent can own end to end.',
          'When preparing a Squad launch, describe the outcome and include any requirements or checks the Squad should follow. Review the Inbox launch card if your launch requires review.'
        ]
      }
    ]
  }
];

const stopWords = new Set([
  'a', 'an', 'and', 'are', 'can', 'do', 'does', 'for', 'how', 'i', 'in', 'is', 'it', 'me',
  'of', 'on', 'or', 'should', 'the', 'to', 'use', 'what', 'when', 'where', 'why', 'with', 'won', 'zana'
]);

function words(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((word) => word.length > 2 && !stopWords.has(word)));
}

const index = guides.map((guide) => ({
  guide,
  title: words(guide.title),
  terms: words(guide.terms),
  headings: words(guide.sections.map(({ title }) => title).join(' ')),
  body: words(guide.summary + ' ' + guide.sections.flatMap(({ steps }) => steps).join(' '))
}));

export function searchGuides(question: string): Guide[] {
  const query = words(question);
  return index.map(({ guide, title, terms, headings, body }) => {
    let score = 0;
    for (const word of query) {
      if (title.has(word)) score += 5;
      else if (terms.has(word)) score += 3;
      else if (headings.has(word)) score += 2;
      else if (body.has(word)) score += 1;
    }
    return { guide, score };
  })
    .filter(({ score }) => score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ guide }) => guide);
}
