---
name: zana-ui-proposals
description: Proactively create interactive UI proposals and compare design alternatives when building or changing user-facing features in Zana Command Center or any Zana plugin. Apply during feature exploration, layout and interaction design, and substantial UI changes even when the user has not explicitly requested a mockup. Keep trivial fixes lightweight.
---

# Interactive UI proposals for Zana

Use working, realistic previews to explore UI decisions. For meaningful new or
changed user-facing features in Zana or any Zana plugin, proactively build and
show an interactive proposal early, before committing to the product
implementation. Backend-only work does not need a UI proposal.

## Choose what to compare

- Inspect the existing UI and relevant project instructions first. Preserve
  Zana's visual language, terminology, layout rules, and the plugin's context.
- Identify the design decision the user can usefully evaluate. Offer distinct
  alternatives when there is a real layout, interaction, or workflow tradeoff;
  briefly recommend one and explain its benefit.
- For an existing feature, provide a Current / Proposed toggle when it helps
  compare behavior. For a new feature, use named alternatives. Keep equivalent
  content and state across variants so the comparison is fair.
- Scale the preview to the task. A small interaction can use one focused mock;
  a larger feature can compare several directions. Do not invent alternatives
  or create a prototype for a trivial copy, spacing, or obvious bug fix unless
  the user asks.

## Make the proposal usable

Build a self-contained HTML/CSS/JS mock or a small local prototype, choosing
the simplest format that demonstrates the decision. Include enough surrounding
app UI to judge placement, density, and hierarchy. Use realistic sample data
and app theme tokens or a faithful visual approximation.

Make the interactions under review work: for example opening and closing a
picker, searching, selecting a row, switching tabs, scrolling, and showing the
resulting state. Include keyboard behavior and relevant empty, loading, or
error states when those affect the decision. Light/dark and narrow/wide
controls are useful when the feature needs them, rather than mandatory chrome.

Provide a small review toolbar with clearly named variants and a short note
about what to try. Label the preview as a mock and distinguish simulated
behavior from live integrations. Keep prototype controls and explanatory notes
outside the simulated product UI.

## Show, verify, and continue

- Run the preview locally with automatic external-browser opening disabled.
  In Zana desktop, read `zcc guide browser` and show it in the current thread's
  in-app browser. Use `preview_file` if the user asks to open the source file.
  In remote chat, return an accessible shared preview or artifact through that
  conversation; a localhost URL alone is not remotely accessible. If sharing
  is unavailable, explain that limitation and return useful text and supported
  artifacts through the conversation instead of opening desktop panels.
- Exercise the comparison controls and the key interactions before presenting
  it. Check for clipping and unusable scrolling at the relevant window size.
- Explain the main differences and recommendation concisely, and retain an
  editable artifact so feedback can be applied to the same preview.
- Respect the user's requested scope and existing authorization. A proposal
  does not introduce an automatic approval gate: continue authorized work, and
  pause for a design choice only when it is necessary or the user requested
  review first. An explicit request to skip mockups or implement a chosen
  design directly takes precedence.
- Create a design doc only when explicitly requested. Ordinary UI proposals
  can remain local prototypes presented in chat.
