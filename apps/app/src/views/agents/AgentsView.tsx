import { AgentsBoard } from '@/views/agents/AgentsBoard';

/**
 * Cross-project Agents nav: the same {@link AgentsBoard} as a workspace, scoped
 * to every project. Column 2 is {@link AgentsListPane}; this is the board.
 */
export function AgentsView() {
  return <AgentsBoard scope={{ kind: 'global' }} />;
}

export { AgentsView as GlobalAgentsBoard };
