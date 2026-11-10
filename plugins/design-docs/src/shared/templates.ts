/**
 * Starter file sets for a new design doc. `{{title}}` and `{{summary}}` are
 * substituted at creation time (escaped in HTML pages). A template opens on
 * its `entryPath`, else on `README.md`.
 */
import { ISSUE_AGENTS_CONTENT, ISSUE_MD_CONTENT, ISSUE_RESEARCH_MD_CONTENT, PLAN_MD_CONTENT, PRODUCT_AGENTS_CONTENT, RESEARCH_AGENTS_CONTENT, RESEARCH_MD_CONTENT } from './template-docs.js';
import { HTML_DESIGN_INDEX_CONTENT, REPORT_INDEX_CONTENT, REPORT_WEEKLY_CSV_CONTENT } from './site-templates.js';

export interface DesignDocTemplate {
  id: string;
  label: string;
  description: string;
  files: ReadonlyArray<{ path: string; content: string; encoding?: 'utf8' | 'base64' }>;
  entryPath?: string;
}

const TECHNICAL_README_CONTENT = `# {{title}}

> {{summary}}

## Context

What problem are we solving, for whom, and why now? Link the evidence
(incidents, metrics, user feedback) that motivates the change.

## Goals

- …

## Non-goals

- …

## Proposal

A short overview of the solution. The diagram lives in
\`diagrams/architecture.mmd\`.

\`\`\`mermaid
flowchart LR
  Client --> API[Service API]
  API --> Store[(Storage)]
\`\`\`

## Detailed design

### Data model

### Interfaces & APIs

### Failure modes

## Alternatives considered

| Option | Pros | Cons |
| --- | --- | --- |
| … | … | … |

## Risks & mitigations

## Rollout & migration

## Testing strategy

## Open questions

- [ ] …
`;

const ARCHITECTURE_MMD_CONTENT = `flowchart LR
  user([User]) --> ui[Client]
  ui --> api[Service API]
  api --> db[(Database)]
  api --> queue[[Queue]]
  queue --> worker[Worker]
`;

const PRODUCT_README_CONTENT = `# {{title}}

> {{summary}}

## Problem

## Users & jobs to be done

## Goals & success metrics

| Metric | Today | Target |
| --- | --- | --- |
| … | … | … |

## Scope

**In scope**

- …

**Out of scope**

- …

## Experience

Key flows. A clickable mockup lives in \`mockups/overview.html\`.

## Requirements

| # | Requirement | Priority |
| --- | --- | --- |
| R1 | … | Must |

## Launch plan

## Open questions

- [ ] …
`;

const PRODUCT_MOCKUP_CONTENT = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>{{title}} — mockup</title>
<style>
  :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif; }
  body { margin: 0; padding: 32px; background: Canvas; color: CanvasText; }
  .card { max-width: 420px; padding: 20px 24px; border: 1px solid color-mix(in srgb, CanvasText 15%, transparent); border-radius: 12px; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  p { margin: 0 0 16px; opacity: 0.75; font-size: 13px; line-height: 1.5; }
  button { font: inherit; padding: 6px 14px; border-radius: 6px; border: 0; background: #2f81f7; color: white; cursor: pointer; }
</style>
</head>
<body>
  <div class="card">
    <h1>{{title}}</h1>
    <p>Replace this with the screen you are proposing.</p>
    <button type="button">Primary action</button>
  </div>
</body>
</html>
`;

const ADR_README_CONTENT = `# {{title}}

- **Status:** Proposed
- **Deciders:** …
- **Date:** …

## Context

{{summary}}

## Decision

We will …

## Options considered

1. **Option A** — …
2. **Option B** — …

## Consequences

**Positive**

- …

**Negative / trade-offs**

- …
`;

const API_README_CONTENT = `# {{title}}

> {{summary}}

## Overview

## Resources

| Method | Path | Description |
| --- | --- | --- |
| GET | \`/v1/items\` | List items |
| POST | \`/v1/items\` | Create an item |

The full contract lives in \`api/openapi.yaml\`.

## Authentication & authorization

## Errors

## Versioning & compatibility

## Open questions

- [ ] …
`;

const API_OPENAPI_CONTENT = `openapi: 3.1.0
info:
  title: {{title}}
  version: 0.1.0
paths:
  /v1/items:
    get:
      summary: List items
      responses:
        '200':
          description: OK
`;

export const DESIGN_DOC_TEMPLATES: readonly DesignDocTemplate[] = [
  {
    id: 'technical',
    label: 'Technical design',
    description: 'RFC-style design: context, goals, proposal, alternatives, rollout.',
    files: [
      { path: 'README.md', content: TECHNICAL_README_CONTENT },
      { path: 'diagrams/architecture.mmd', content: ARCHITECTURE_MMD_CONTENT }
    ]
  },
  {
    id: 'product',
    label: 'Product spec',
    description: 'Problem, users, metrics, scope, requirements, an HTML mockup and an implementation plan.',
    files: [
      { path: 'README.md', content: PRODUCT_README_CONTENT },
      { path: 'mockups/overview.html', content: PRODUCT_MOCKUP_CONTENT },
      { path: 'plan.md', content: PLAN_MD_CONTENT },
      { path: 'AGENTS.md', content: PRODUCT_AGENTS_CONTENT }
    ]
  },
  {
    id: 'adr',
    label: 'Decision record',
    description: 'A single architectural decision with options and consequences.',
    files: [{ path: 'README.md', content: ADR_README_CONTENT }]
  },
  {
    id: 'research',
    label: 'Research',
    description: 'Evidence-led investigation with a recommendation, and a plan for what follows.',
    entryPath: 'research.md',
    files: [
      { path: 'research.md', content: RESEARCH_MD_CONTENT },
      { path: 'plan.md', content: PLAN_MD_CONTENT },
      { path: 'AGENTS.md', content: RESEARCH_AGENTS_CONTENT }
    ]
  },
  {
    id: 'issue',
    label: 'Issue',
    description: 'Problem, impact, evidence, root cause and resolution, with optional research and a fix plan.',
    entryPath: 'issue.md',
    files: [
      { path: 'issue.md', content: ISSUE_MD_CONTENT },
      { path: 'research.md', content: ISSUE_RESEARCH_MD_CONTENT },
      { path: 'plan.md', content: PLAN_MD_CONTENT },
      { path: 'AGENTS.md', content: ISSUE_AGENTS_CONTENT }
    ]
  },
  {
    id: 'api',
    label: 'API design',
    description: 'Resources, auth, errors and an OpenAPI contract.',
    files: [
      { path: 'README.md', content: API_README_CONTENT },
      { path: 'api/openapi.yaml', content: API_OPENAPI_CONTENT }
    ]
  },
  {
    id: 'report',
    label: 'Interactive report',
    description: 'A one-page site: KPIs, charts from CSV, a sortable table. Publishes to GitHub Pages.',
    entryPath: 'index.html',
    files: [
      { path: 'index.html', content: REPORT_INDEX_CONTENT },
      { path: 'data/weekly.csv', content: REPORT_WEEKLY_CSV_CONTENT }
    ]
  },
  {
    id: 'html-design',
    label: 'HTML design doc',
    description: 'A technical design as a web page with section nav. Publishes to GitHub Pages.',
    entryPath: 'index.html',
    files: [{ path: 'index.html', content: HTML_DESIGN_INDEX_CONTENT }]
  },
  {
    id: 'blank',
    label: 'Blank',
    description: 'A single README.md to start from scratch.',
    files: [{ path: 'README.md', content: '# {{title}}\n\n{{summary}}\n' }]
  }
];

export const DEFAULT_TEMPLATE_ID = 'technical';

export function templateById(id: unknown): DesignDocTemplate | null {
  return DESIGN_DOC_TEMPLATES.find((template) => template.id === id) ?? null;
}

export function renderTemplateFiles(
  template: DesignDocTemplate,
  values: { title: string; summary: string }
): Array<{ path: string; content: string; encoding?: 'utf8' | 'base64' }> {
  const summary = values.summary.trim() || 'One-paragraph summary of the proposal.';
  return template.files.map((file) => {
    if (file.encoding === 'base64') return { ...file };
    const page = /\.html?$/i.test(file.path);
    const text = (value: string) => (page ? escapeHtml(value) : value);
    return { path: file.path, content: file.content.replaceAll('{{title}}', text(values.title)).replaceAll('{{summary}}', text(summary)) };
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
