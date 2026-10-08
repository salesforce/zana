/**
 * Starter file sets for a new design doc. `{{title}}` and `{{summary}}` are
 * substituted at creation time (escaped in HTML pages). A template opens on
 * its `entryPath`, else on `README.md`.
 */
import { HTML_DESIGN_INDEX, REPORT_INDEX, REPORT_WEEKLY_CSV } from './site-templates.js';

export interface DesignDocTemplate {
  id: string;
  label: string;
  description: string;
  files: ReadonlyArray<{ path: string; content: string }>;
  entryPath?: string;
}

const TECHNICAL_README = `# {{title}}

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

const ARCHITECTURE_MMD = `flowchart LR
  user([User]) --> ui[Client]
  ui --> api[Service API]
  api --> db[(Database)]
  api --> queue[[Queue]]
  queue --> worker[Worker]
`;

const PRODUCT_README = `# {{title}}

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

const PRODUCT_MOCKUP = `<!doctype html>
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

const ADR_README = `# {{title}}

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

const API_README = `# {{title}}

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

const API_OPENAPI = `openapi: 3.1.0
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
      { path: 'README.md', content: TECHNICAL_README },
      { path: 'diagrams/architecture.mmd', content: ARCHITECTURE_MMD }
    ]
  },
  {
    id: 'product',
    label: 'Product spec',
    description: 'Problem, users, metrics, scope, requirements and an HTML mockup.',
    files: [
      { path: 'README.md', content: PRODUCT_README },
      { path: 'mockups/overview.html', content: PRODUCT_MOCKUP }
    ]
  },
  {
    id: 'adr',
    label: 'Decision record',
    description: 'A single architectural decision with options and consequences.',
    files: [{ path: 'README.md', content: ADR_README }]
  },
  {
    id: 'api',
    label: 'API design',
    description: 'Resources, auth, errors and an OpenAPI contract.',
    files: [
      { path: 'README.md', content: API_README },
      { path: 'api/openapi.yaml', content: API_OPENAPI }
    ]
  },
  {
    id: 'report',
    label: 'Interactive report',
    description: 'A one-page site: KPIs, charts from CSV, a sortable table. Publishes to GitHub Pages.',
    entryPath: 'index.html',
    files: [
      { path: 'index.html', content: REPORT_INDEX },
      { path: 'data/weekly.csv', content: REPORT_WEEKLY_CSV }
    ]
  },
  {
    id: 'html-design',
    label: 'HTML design doc',
    description: 'A technical design as a web page with section nav. Publishes to GitHub Pages.',
    entryPath: 'index.html',
    files: [{ path: 'index.html', content: HTML_DESIGN_INDEX }]
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
): Array<{ path: string; content: string }> {
  const summary = values.summary.trim() || 'One-paragraph summary of the proposal.';
  return template.files.map((file) => {
    const page = /\.html?$/i.test(file.path);
    const text = (value: string) => (page ? escapeHtml(value) : value);
    return { path: file.path, content: file.content.replaceAll('{{title}}', text(values.title)).replaceAll('{{summary}}', text(summary)) };
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
