/**
 * Single --sf-* custom-property set for Salesforce Studio, mapped onto Zana host
 * tokens. All new Studio CSS must use only these variables (no raw colors).
 * Mount once on the Studio root: `<style>{STUDIO_TOKENS}</style>`.
 */
export const STUDIO_TOKENS = `
.sf-studio, .sf-as { --sf-bg: var(--bg-panel); --sf-text: var(--text-primary); --sf-muted: var(--text-muted); --sf-border: var(--border); --sf-accent: var(--accent); --sf-danger: var(--danger); --sf-success: var(--success); --sf-warn: var(--accent-gold); }
`;
