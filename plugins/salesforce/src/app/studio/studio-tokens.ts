/**
 * Single --sf-* custom-property set for Salesforce Studio, mapped onto Zana host
 * tokens. All Studio CSS must use only these variables (no raw colors, no per-panel
 * --sf-as-*, --af-*, --sf-soql-* aliases). Every style string that uses them starts
 * with `STUDIO_TOKENS`, and the Studio root also mounts it: `<style>{STUDIO_TOKENS}</style>`.
 */
export const STUDIO_TOKENS = `
.sf-studio, .sf-as, .sf-soql, .sf-dcard { --sf-bg: var(--bg-panel); --sf-surface: var(--bg-panel); --sf-elevated: var(--bg-elevated, var(--bg-panel)); --sf-sunken: var(--bg-base); --sf-text: var(--text-primary); --sf-muted: var(--text-muted); --sf-border: var(--border); --sf-accent: var(--accent); --sf-soft: color-mix(in srgb, var(--accent) 10%, transparent); --sf-on-accent: var(--text-on-accent, #fff); --sf-danger: var(--danger); --sf-success: var(--success); --sf-warn: var(--accent-gold); }
`;
