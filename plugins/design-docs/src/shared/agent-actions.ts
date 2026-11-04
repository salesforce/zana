/**
 * One-click agent requests offered on a doc. The UI shows them; the server
 * turns the chosen one into the opening prompt of a new agent thread.
 */

export interface AgentAction {
  id: string;
  label: string;
  /** Tooltip + menu description. */
  description: string;
  /** Lucide icon name. */
  icon: string;
  instruction: string;
}

export const AGENT_ACTIONS: readonly AgentAction[] = [
  {
    id: 'review',
    label: 'Review',
    description: 'Critical review with anchored comments',
    icon: 'MessageSquareText',
    instruction:
      'Review this design doc critically, as a senior engineer would before approving it. Leave one review comment per issue with design_doc_comment (anchor it with path and an exact quote) covering gaps, risks, ambiguities, contradictions and missing alternatives. Do not rewrite the doc yourself. Finish with a short summary of the most important issues.'
  },
  {
    id: 'address',
    label: 'Address comments',
    description: 'Apply the open review feedback',
    icon: 'CheckCheck',
    instruction:
      'Address every open review comment on this design doc: make the edits each one asks for (or explain why not), then resolve each comment with design_doc_comment resolve=<id> and a one-line body describing what changed.'
  },
  {
    id: 'complete',
    label: 'Fill the gaps',
    description: 'Complete empty or placeholder sections',
    icon: 'WandSparkles',
    instruction:
      "Complete the sections of this design doc that are empty, placeholders (…) or thin. Keep the author's intent and voice, ground statements in this project's code where relevant, and mark assumptions explicitly as **Assumption:**."
  },
  {
    id: 'diagram',
    label: 'Add diagrams',
    description: 'Mermaid architecture, flow and sequence diagrams',
    icon: 'Workflow',
    instruction:
      'Add mermaid diagrams that make this design easier to understand: architecture/components, the main data flow, and the key sequence(s). Put each larger diagram in diagrams/<name>.mmd and embed small ones inline as ```mermaid blocks where they help the narrative. Make sure every diagram parses.'
  },
  {
    id: 'ground',
    label: 'Check against code',
    description: "Verify claims against this project's code",
    icon: 'ScanSearch',
    instruction:
      "Check this design doc against the project's actual codebase. Correct inaccurate statements, name the real files, modules and APIs involved, and leave a comment wherever the design conflicts with how the code works today."
  },
  {
    id: 'plan',
    label: 'Implementation plan',
    description: 'Milestones, tasks, risks and tests',
    icon: 'ListChecks',
    instruction:
      'Turn this design into an implementation plan. Add a plan.md file with milestones, ordered tasks (each small enough for one pull request), dependencies, risks and a test strategy, grounded in this project\'s code. Link plan.md from the README.'
  }
];

export function agentActionById(id: unknown): AgentAction | null {
  return AGENT_ACTIONS.find((action) => action.id === id) ?? null;
}

export const MAX_AGENT_PROMPT_LENGTH = 4000;

export function buildAgentPrompt(args: {
  doc: { id: string; title: string };
  action?: AgentAction | null;
  prompt?: string;
  path?: string | null;
}): string {
  const focus = args.path ? ` Focus on ${args.path}.` : '';
  const request = [args.action?.instruction, args.prompt?.trim()].filter(Boolean).join('\n\n');
  return [
    `You are working on the design doc "${args.doc.title}" (id ${args.doc.id}) in the Design Docs plugin.${focus}`,
    request,
    `Start with design_doc_read doc="${args.doc.id}" to see its files and open comments. Make changes in the doc itself with design_doc_write (prefer small edits with baseRevision) and design_doc_comment, rather than pasting long content into chat. The user is watching the doc update live. When you finish, summarise what you changed and end with ::design-doc{id="${args.doc.id}"} on its own line.`
  ]
    .filter(Boolean)
    .join('\n\n');
}
