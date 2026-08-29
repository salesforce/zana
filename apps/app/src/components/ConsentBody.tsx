/**
 * Shared, purely-presentational body for the extension consent surfaces. The
 * transient global overlay (`ExtensionConsent`) and the persistent inline
 * `ConsentCard` in the Extensions hub both render this, so the perms delta,
 * scope lines, and remote-origin provenance can NEVER drift between the two
 * surfaces (e.g. a loud "⚠ ANY host" wildcard must read identically in both).
 *
 * This module owns the pure helpers (`PERMISSION_LABELS`, `consentDelta`,
 * `scopeLines`); `ExtensionConsent` re-exports them for back-compat with the
 * existing import sites + guard tests.
 */

import type { ExtensionEntry } from '@zana-ai/zcc-domain/product';

/**
 * Plain-language descriptions of each permission. The key is the
 * `ExtensionPermission` token; the value is what the user reads. Unknown tokens
 * fall back to the raw string so a future permission still renders something.
 */
export const PERMISSION_LABELS: Record<string, string> = {
  storage: 'Save its own settings and data',
  'projects:read': 'See your open projects',
  'projects:select': 'Switch the selected project',
  'session:launch': 'Launch Claude sessions in your projects',
  'external:open': 'Open web links in your browser',
  'inbox:push': 'Post messages to your inbox',
  'ssh:hosts': 'Read SSH host entries for the remote-project picker',
  exec: 'Run specific command-line tools',
  'fs:read': 'Read files in allowed folders',
  'fs:write': 'Write files in allowed folders',
  net: 'Connect to specific web hosts',
  mcp: 'Use specific integration servers',
  'llm:invoke': '⚠ Make AI model calls (uses your AI quota / cost)',
  stream: '⚠ Subscribe to live data feeds',
  'agent:contribute': '⚠ Add new skills and integration servers your agents can use'
};

function permLabel(p: string): string {
  return PERMISSION_LABELS[p] ?? p;
}

/** The partition a `'widened'` re-prompt shows: new vs already-approved tokens. */
export interface ConsentDelta {
  /** Newly-declared permission tokens the user hasn't approved yet. */
  newPerms: string[];
  /** Declared tokens already in the approved snapshot (shown as muted context). */
  approvedPerms: string[];
  /**
   * True when this is a `'widened'` re-prompt with NO new token — i.e. only a
   * SCOPE broadened (a wider exec/host/mcp/stream allowlist). The scope lines
   * carry the change; rendering a "New permissions" list would be empty/broken.
   */
  scopeOnlyWiden: boolean;
}

/**
 * Pure: split an entry's declared permissions into the new-vs-already-approved
 * delta for the consent prompt. On a `'new'` prompt everything is new; on a
 * `'widened'` re-prompt the approved snapshot (`consentedPermissions`) decides
 * the split. An absent snapshot ⇒ treat all as new (the safe, loud default).
 * Exported for unit testing the delta without a React render.
 */
export function consentDelta(entry: ExtensionEntry): ConsentDelta {
  const perms = entry.manifest?.permissions ?? [];
  const widened = entry.needsConsent === 'widened';
  const alreadyApproved = new Set(widened ? (entry.consentedPermissions ?? []) : []);
  const newPerms = perms.filter((p) => !alreadyApproved.has(p));
  const approvedPerms = perms.filter((p) => alreadyApproved.has(p));
  return { newPerms, approvedPerms, scopeOnlyWiden: widened && newPerms.length === 0 };
}

/**
 * Scope detail lines for the brokered permissions, when the manifest declares
 * them. Exported for the consent-copy guard test (a pure function of the entry —
 * no React render needed to assert a wildcard renders LOUD).
 */
export function scopeLines(entry: ExtensionEntry): string[] {
  const s = entry.manifest?.permissionScopes;
  if (!s) return [];
  const lines: string[] = [];
  if (s.execAllowlist?.length) {
    lines.push(
      s.execAllowlist.includes('*')
        ? 'Tools it may run: ⚠ ANY tool (unrestricted)'
        : `Tools it may run: ${s.execAllowlist.join(', ')}`
    );
  }
  if (s.fsRoots?.length) lines.push(`Folders it may access: ${s.fsRoots.join(', ')}`);
  if (s.egressAllowlist?.length) {
    lines.push(
      s.egressAllowlist.includes('*')
        ? 'Hosts it may reach: ⚠ ANY host (unrestricted)'
        : `Hosts it may reach: ${s.egressAllowlist.join(', ')}`
    );
  }
  if (s.mcpAllowlist?.length) {
    lines.push(
      s.mcpAllowlist.includes('*')
        ? 'Integration servers it may use: ⚠ ANY server (unrestricted)'
        : `Integration servers it may use: ${s.mcpAllowlist.join(', ')}`
    );
  }
  if (s.streamAllowlist?.length) {
    lines.push(
      s.streamAllowlist.includes('*')
        ? 'Live feeds it may subscribe to: ⚠ ANY feed (unrestricted)'
        : `Live feeds it may subscribe to: ${s.streamAllowlist.join(', ')}`
    );
  }
  return lines;
}

/**
 * `agent:contribute` detail lines: name what a manifest's `skills`/
 * `mcpServers` blocks actually add, so approving the permission isn't a blind
 * trust — the consent screen names the concrete skill files and server
 * commands/urls (never env VALUES; `ExtensionMcpServerContributionView`
 * already strips those before this ever reaches the renderer).
 */
export function pluginCapabilityLines(input: {
  skillNames?: string[];
  mcpServers?: Array<{ name: string; alwaysOn?: boolean }>;
  extra?: Record<string, unknown>;
}): string[] {
  const lines: string[] = [];
  if (input.skillNames?.length) {
    lines.push(`Skills it adds: ${input.skillNames.join(', ')}`);
  }
  if (input.mcpServers?.length) {
    lines.push(
      `Integration servers it adds: ${input.mcpServers
        .map((s) => `${s.name}${s.alwaysOn ? ' (always on)' : ''}`)
        .join(', ')}`
    );
  }
  if (input.extra) {
    for (const [key, value] of Object.entries(input.extra)) {
      lines.push(typeof value === 'string' ? `Also: ${key}: ${value}` : `Also: ${key}`);
    }
  }
  return lines;
}

export function agentCapabilityLines(entry: ExtensionEntry): string[] {
  const m = entry.manifest;
  if (!m?.permissions?.includes('agent:contribute')) return [];
  return pluginCapabilityLines({
    skillNames: m.skills?.map((s) => s.slug ?? s.path),
    mcpServers: m.mcpServers
  });
}

/**
 * Pure presentational body shared by the global consent modal and the hub's
 * inline ConsentCard. Renders: git provenance warning, the perms delta (new vs
 * already-approved on a widen, or a flat list on a `'new'` prompt), and the
 * scope lines. NO buttons, NO title/subtitle — the two hosts own their own
 * chrome + copy.
 */
export function ConsentBody({ entry }: { entry: ExtensionEntry }) {
  const perms = entry.manifest?.permissions ?? [];
  const widened = entry.needsConsent === 'widened';
  const { newPerms, approvedPerms, scopeOnlyWiden } = consentDelta(entry);

  return (
    <>
      {/* Loud remote-origin provenance — repo-installed code is not reviewed by
          Zana. Guarded on source (not remoteOrigin) so a missing provenance
          record still shows the warning with a generic origin. */}
      {entry.source === 'git' && (
        <p className="consent-origin consent-origin--warn">
          ⚠ Installed from a remote repository: {entry.remoteOrigin?.url ?? 'origin unknown'}
          {entry.remoteOrigin?.ref ? ` @ ${entry.remoteOrigin.ref}` : ''} — code not reviewed by
          Zana
        </p>
      )}
      {perms.length === 0 ? (
        <p className="consent-sub">It requests no special permissions.</p>
      ) : widened ? (
        <>
          {/* The delta: the newly-declared permissions the user hasn't approved
              yet — the only thing this re-prompt is actually about. Suppressed
              for a scope-only widening (no new token), where the scope lines
              below carry the change instead of an empty "New permissions" list. */}
          {!scopeOnlyWiden && (
            <>
              <p className="consent-perms-heading">
                New permission{newPerms.length === 1 ? '' : 's'}
              </p>
              <ul className="consent-perms">
                {newPerms.map((p) => (
                  <li key={p} className="consent-perm--new">
                    <span className="consent-perm-badge" aria-hidden="true">
                      NEW
                    </span>
                    {permLabel(p)}
                  </li>
                ))}
              </ul>
            </>
          )}
          {/* The already-approved permissions, de-emphasized, for context only. */}
          {approvedPerms.length > 0 && (
            <>
              <p className="consent-perms-heading consent-perms-heading--muted">Already approved</p>
              <ul className="consent-perms consent-perms--muted">
                {approvedPerms.map((p) => (
                  <li key={p}>{permLabel(p)}</li>
                ))}
              </ul>
            </>
          )}
        </>
      ) : (
        <ul className="consent-perms">
          {perms.map((p) => (
            <li key={p}>{permLabel(p)}</li>
          ))}
        </ul>
      )}
      {scopeLines(entry).map((line) => (
        <p key={line} className="consent-scope">
          {line}
        </p>
      ))}
      {agentCapabilityLines(entry).map((line) => (
        <p key={line} className="consent-scope">
          {line}
        </p>
      ))}
    </>
  );
}
