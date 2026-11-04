import { cityBuildings } from '../../lib/agent-city/model';

// Public, fixed examples only. This demo never connects to a visitor's agents.
const examples = [
  { id: 'checkout', name: 'Checkout', tasks: ['Fix checkout tests', 'Review the payment flow', 'Check error handling', 'Update API types', 'Run the test suite', 'Review the diff', 'Prepare the release'] },
  { id: 'website', name: 'Website', tasks: ['Build the landing page', 'Check mobile layouts', 'Review accessibility'] },
  { id: 'docs', name: 'Docs', tasks: ['Update the getting started guide'] }
];

export const CITY_PROJECTS = examples.map((project, index) => {
  const members = project.tasks.map((title, i) => ({
    key: `${project.id}-${i}`,
    id: `${project.id}-${i}`,
    projectId: project.id,
    kind: 'thread',
    title,
    live: true,
    status: index === 0 && i === 0 ? 'needs-you' : i < project.tasks.length - 1 ? 'working' : 'idle',
    harness: ['Claude Code', 'Codex', 'Cursor'][i % 3]
  }));
  return { id: project.id, name: project.name, members, schedules: [], count: members.length,
    working: members.filter((member) => member.status === 'working').length,
    needs: members.filter((member) => member.status === 'needs-you').length };
});
export const CITY_BUILDINGS = cityBuildings(CITY_PROJECTS, new Map(CITY_PROJECTS.map((project, i) => [project.id, i])));
