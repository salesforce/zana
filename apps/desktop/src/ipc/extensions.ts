// @ts-nocheck
import { ipcMain } from 'electron';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { ctx } from './ctx.js';
import { installFromArchiveFile, installFromBundled, installFromDir, installFromGit, listBundledCatalog, locateManifestDir, uninstallExtension } from '@zana-ai/zcc-server/services/extensions/extension-installer';
import {
  defaultBundledRoot,
  defaultPluginDataDir,
  installBundledPlugin,
  listBundledPluginCatalog
} from '@zana-ai/zcc-server/plugins/plugin-service';
import { createPluginStore, pluginStorePath } from '@zana-ai/zcc-server/plugins/plugin-store';
import { applyRelease, listMarketplace, maybeCheckRemoteUpdates, resolveMarketplaceRelease } from '@zana-ai/zcc-server/services/extensions/extension-registry';
import { grantConsent, pruneConsentedPermission, revokeConsent } from '../extensions/consent.js';
import { addExtensionPermission, clearGit, clearLocal, extensionDir, getGitRecord, getLocalRecord, markGit, readRendererEntry, removeExtensionPermission, setExtensionEnabled } from '../extensions/discovery.js';
import { cloneProject } from '@zana-ai/zcc-server/services/projects/git-clone';
import { prepareShareDir, readWorkingDirId, isZccPluginWorkingDir } from '@zana-ai/zcc-server/services/extensions/local-extension';
import { ensureMcpConfigForProject, rebuildExtensionServers } from '@zana-ai/zcc-host-daemon/mcp-config';
import { applyPluginAgentCapabilities } from '@zana-ai/zcc-server/services/extensions/plugin-agent-sync';
import { redeployBundledSkills, removeSkillsForExtension, syncExtensionSkills } from '@zana-ai/zcc-server/services/skills/skill-installer';
import { scratchWorkspaceRoot, store } from '@zana-ai/zcc-server/services/projects/store';
import { BrowserWindow, dialog, shell } from 'electron';
import { existsSync, realpathSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { AdoptLocalExtensionGitRequest, CreateLocalExtensionRequest, CreateLocalExtensionResult, ExtensionInstallSource, ExtensionUpdateOutcome, MarketplaceEntry, Result } from '@zana-ai/zcc-domain/product';

export function registerExtensionsIpc(): void {
  


  // Runtime extensions (~/.zcc/extensions/<id>/). Mirrors the plugins
  // handlers. `list` returns the latest scan; `setEnabled` flips the
  // enabled-map. Model: a renderer-only extension takes effect immediately; a
  // main-bearing extension's MAIN side (its capabilities) activates only at
  // boot — so enabling one leaves `mainActive:false` until relaunch, and
  // disabling tears the live main module down now.
  ctx.safeHandle(IPC.extensions.list, () => ctx.extensionEntries, () => []);
  ctx.safeHandle(
    IPC.extensions.setEnabled,
    async (id: string, enabled: boolean): Promise<Result<true>> => {
      const res = await setExtensionEnabled(id, enabled);
      if (res.ok) {
        if (enabled) {
          // ENABLE → reconcile the disk so a now-enabled, CONSENTED main-bearing
          // extension spawns live right away (out-of-process: `spawn()` is a fresh
          // fork, NOT a cached in-process `import()`, so no relaunch is needed —
          // the old "activates on next relaunch" caveat was from the pre-P3-A
          // in-process era). An unconsented ext still won't spawn (loadBoot emits
          // no spec until consent — P3-D), and a renderer-only one just re-stamps.
          await ctx.runDiskSync();
        } else {
          // DISABLE → tear the live module down now (await teardown, drop caps);
          // ctx.emitExtensionsChanged then re-stamps mainActive:false from the host.
          await ctx.moduleRouter.teardown(id);
          void ctx.emitExtensionsChanged();
        }
      }
      return res;
    },
    (err): Result<true> => ({
      ok: false,
      code: 'WRITE_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  ctx.safeHandle(
    IPC.extensions.reveal,
    async (id: string): Promise<Result<true>> => {
      const dir = extensionDir(id);
      if (!existsSync(dir)) {
        return { ok: false, code: 'NOT_FOUND', message: `Extension not found: ${id}` };
      }
      await shell.openPath(dir);
      return { ok: true, value: true };
    },
    (err): Result<true> => ({
      ok: false,
      code: 'REVEAL_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  ctx.safeHandle(
    IPC.extensions.readRendererEntry,
    (id: string) => readRendererEntry(id, ctx.logMainError),
    () => null
  );
  // P3-D: persist consent to the extension's CURRENT declared permissions, then
  // re-discover. consentMap refreshes inside ctx.emitExtensionsChanged, so the
  // GrantProvider immediately reflects the grant. A renderer-only ext mounts on
  // the next reconcile; a main-bearing ext spawns on the next relaunch (same
  // model as enable — an already-running process isn't hot-swapped). We grant to
  // the live manifest's declared list so consent always matches what was shown.
  ctx.safeHandle(
    IPC.extensions.grantConsent,
    async (id: string): Promise<Result<true>> => {
      const entry = ctx.extensionEntries.find((e) => e.id === id);
      if (!entry || !entry.manifest) {
        return { ok: false, code: 'NOT_FOUND', message: `Extension not found: ${id}` };
      }
      // Grant to the live manifest's declared permissions AND scope allowlists,
      // so a later scope-widening update re-prompts (consent tracks scopes, not
      // just tokens — the update-from-repo escalation guard).
      const res = await grantConsent(id, entry.manifest.permissions, entry.manifest.permissionScopes);
      if (res.ok) void ctx.emitExtensionsChanged();
      return res;
    },
    (err): Result<true> => ({
      ok: false,
      code: 'WRITE_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  // Declare an extra permission in the extension's manifest, then re-discover.
  // This only WIDENS the declared set — ctx.emitExtensionsChanged re-stamps the
  // entry as needsConsent:'widened', so the consent prompt fires and the user
  // must approve before it's effective. Adding a permission never grants it.
  ctx.safeHandle(
    IPC.extensions.addPermission,
    async (id: string, permission: string): Promise<Result<true>> => {
      const res = await addExtensionPermission(id, permission);
      if (res.ok) void ctx.emitExtensionsChanged();
      return res;
    },
    (err): Result<true> => ({
      ok: false,
      code: 'WRITE_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  // Remove a declared permission: narrow the manifest, then prune the token from
  // the consent record so a later re-add re-prompts (the manifest narrowing is
  // silent). We AWAIT the prune BEFORE emitting (unlike addPermission's
  // fire-and-forget) so re-discovery sees the narrowed approved set — no
  // read-back race that could re-stamp a phantom 'widened'.
  ctx.safeHandle(
    IPC.extensions.removePermission,
    async (id: string, permission: string): Promise<Result<true>> => {
      const res = await removeExtensionPermission(id, permission);
      if (res.ok) {
        await pruneConsentedPermission(id, permission).catch((err) =>
          ctx.logMainError(`pruneConsentedPermission ${id}`, err)
        );
        void ctx.emitExtensionsChanged();
      }
      return res;
    },
    (err): Result<true> => ({
      ok: false,
      code: 'WRITE_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  // Relaunch a disk extension's child: teardown (no-op if already dead/crashed)
  // then respawn from its retained spec. `spawn()` clears the crash record and
  // tears down any live child first, so this recovers a crashed OR hung backend.
  // Built-ins (in-process, no child) return ok:false — nothing to respawn.
  ctx.safeHandle(
    IPC.extensions.relaunch,
    async (id: string): Promise<Result<boolean>> => {
      const spec = ctx.diskSpecsById.get(id);
      if (!spec) {
        return { ok: false, code: 'NOT_FOUND', message: `No disk extension to relaunch: ${id}` };
      }
      const ready = await ctx.extProcessHost.spawn(spec);
      // Re-stamp mainActive from the live set so the renderer reflects the
      // fresh child (or its failure to come up).
      void ctx.emitExtensionsChanged();
      return { ok: true, value: ready };
    },
    (err): Result<boolean> => ({
      ok: false,
      code: 'RELAUNCH_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  // Explicit "Reload" button: re-run the disk-extension reconcile (spawn new,
  // tear down removed, respawn changed). Takes no renderer payload → nothing to
  // validate (Rule #1). The watcher fires the same path automatically.
  ctx.safeHandle(
    IPC.extensions.rescan,
    async (): Promise<Result<true>> => {
      await ctx.runDiskSync();
      return { ok: true, value: true };
    },
    (err): Result<true> => ({
      ok: false,
      code: 'RESCAN_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  // Explicit "Reload skills & MCP" button: re-deploy the runtime capability
  // artifacts the app ships (bundled SKILL.md files) + re-sync every project's
  // `.mcp.json`. These deploy at boot; this re-applies a shipped-content bump
  // (or repairs a stray manual edit) without an app restart. No renderer payload
  // (Rule #1) — main re-reads the bundled roster + its own project list.
  ctx.safeHandle(
    IPC.extensions.redeployCapabilities,
    async (): Promise<Result<{ skills: Array<{ name: string; ok: boolean }>; mcpProjects: number }>> => {
      const skills = await redeployBundledSkills(ctx.logMainError);
      // Re-derive the extension-contributed server registry AND re-sync every
      // extension's own skill deploys from the CURRENT extension state before
      // re-syncing every project's `.mcp.json` — this is the button's literal
      // reason to exist: an extension installed/enabled since the last sync
      // gets its declared servers + skills applied right now, not just at the
      // next boot/rescan.
      rebuildExtensionServers(ctx.extensionEntries);
      await syncExtensionSkills(ctx.extensionEntries, ctx.logMainError);
      try {
        const { createPluginService, defaultBundledRoot, defaultPluginDataDir } = await import('@zana-ai/zcc-server/plugins/plugin-service'
        );
        const pluginService = createPluginService({
          dataDir: defaultPluginDataDir(),
          bundledRoot: defaultBundledRoot()
        });
        await applyPluginAgentCapabilities(pluginService.agentContributions(), ctx.logMainError);
      } catch (err) {
        ctx.logMainError('redeployCapabilities:pluginAgentCapabilities', err);
      }
      const projects = store.listProjects();
      const results = await Promise.all(
        projects.map((p) =>
          ensureMcpConfigForProject(p.id)
            .then(() => true)
            .catch((err) => {
              ctx.logMainError(`redeployCapabilities:ensureMcpConfigForProject(${p.id})`, err);
              return false;
            })
        )
      );
      // Let the skills catalogue refresh (a redeploy may have rewritten files).
      ctx.safeSend(IPC.skills.onChanged);
      return { ok: true, value: { skills, mcpProjects: results.filter(Boolean).length } };
    },
    (err): Result<{ skills: Array<{ name: string; ok: boolean }>; mcpProjects: number }> => ({
      ok: false,
      code: 'REDEPLOY_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  // Install on demand. Main owns every trust decision (Rule #1): for local
  // kinds it opens the OS picker ITSELF (the renderer never supplies a path),
  // and validates manifest/id/containment/reserved/API in `installFromDir`. The
  // marketplace kind resolves the best release from the opt-in registry and
  // applies it through the same verified channel as auto-update.
  ctx.safeHandle(
    IPC.extensions.install,
    async (source: ExtensionInstallSource): Promise<Result<{ id: string }>> => {
      const installOpts = { reservedIds: ctx.builtinIds, log: ctx.logMainError };
      let res: Result<{ id: string }>;
      const win = BrowserWindow.getFocusedWindow() ?? ctx.mainWindow();
      if (source.kind === 'localDir') {
        if (!win) return { ok: false, code: 'NO_WINDOW', message: 'No window to host the picker' };
        const pick = await dialog.showOpenDialog(win, {
          title: 'Install extension from folder',
          properties: ['openDirectory']
        });
        if (pick.canceled || !pick.filePaths[0]) {
          return { ok: false, code: 'CANCELED', message: 'Install canceled' };
        }
        if (isZccPluginWorkingDir(pick.filePaths[0])) {
          if (!ctx.runtimeSupervisor) {
            return { ok: false, code: 'UNAVAILABLE', message: 'plugin host is unavailable' };
          }
          const row = await ctx.runtimeSupervisor.installPlugin(pick.filePaths[0]);
          const id =
            row && typeof row === 'object' && 'id' in row ? String((row as { id: unknown }).id) : '';
          if (!id) {
            return { ok: false, code: 'INSTALL_FAILED', message: 'plugin install did not return an id' };
          }
          return { ok: true, value: { id } };
        }
        res = await installFromDir(pick.filePaths[0], installOpts);
      } else if (source.kind === 'localArchive') {
        if (!win) return { ok: false, code: 'NO_WINDOW', message: 'No window to host the picker' };
        const pick = await dialog.showOpenDialog(win, {
          title: 'Install extension from archive',
          properties: ['openFile'],
          filters: [{ name: 'Extension archive', extensions: ['json'] }]
        });
        if (pick.canceled || !pick.filePaths[0]) {
          return { ok: false, code: 'CANCELED', message: 'Install canceled' };
        }
        res = await installFromArchiveFile(pick.filePaths[0], installOpts);
      } else if (source.kind === 'marketplace') {
        const resolved = await resolveMarketplaceRelease(source.id, ctx.logMainError);
        if (!resolved) {
          return {
            ok: false,
            code: 'NOT_FOUND',
            message: `No installable release for "${source.id}" (registry off or id not offered)`
          };
        }
        const outcome = await applyRelease(resolved.release, resolved.deps);
        if (outcome.status === 'needs-consent') {
          // The release widens permissions — install the bytes is held back; the
          // user must re-consent. Surface as a typed failure the UI can explain.
          return {
            ok: false,
            code: 'NEEDS_CONSENT',
            message: `"${source.id}" requests new permissions: ${(outcome.addedPermissions ?? []).join(', ')}`
          };
        }
        if (outcome.status === 'error') {
          return { ok: false, code: 'INSTALL_FAILED', message: outcome.error ?? 'install failed' };
        }
        res = { ok: true, value: { id: source.id } };
      } else if (source.kind === 'git') {
        // Install from a remote repo. Main normalizes + clones the url, validates
        // the ref, confines the manifest dir, scrubs the tree, and funnels the
        // staged copy through installFromDir — same consent + broker gates as a
        // local dir. Progress streams to the renderer via installProgress.
        const gitRes = await installFromGit(
          source.url,
          { ref: source.ref, subdir: source.subdir, onProgress: (line) => ctx.safeSend(IPC.extensions.installProgress, line) },
          installOpts
        );
        if (!gitRes.ok) {
          res = gitRes;
        } else {
          // Record provenance FAIL-CLOSED: the remote-origin warning on the
          // consent screen is the only carrier of "unreviewed remote code", so a
          // failed provenance write must fail the install rather than leave a git
          // extension with no origin badge. markGit is mutex-guarded (Rule 4).
          const rec = await markGit(gitRes.value.id, {
            ...gitRes.value.provenance,
            installedAt: new Date().toISOString()
          });
          if (!rec.ok) {
            // Roll the just-installed bytes back out so we don't leave an
            // un-provenanced git extension behind.
            await uninstallExtension(gitRes.value.id, { reservedIds: ctx.builtinIds, log: ctx.logMainError }).catch(
              () => {}
            );
            return { ok: false, code: 'WRITE_FAILED', message: 'Could not record extension provenance' };
          }
          res = { ok: true, value: { id: gitRes.value.id } };
        }
      } else if (source.kind === 'bundled') {
        // Reinstall a first-party plugin or leftover disk extension from the
        // app's own resources (no network, no picker). Plugin-model packages
        // live under `plugins/`; `extension.json` artifacts still use installFromBundled.
        const pluginRes = await installBundledPlugin(source.id);
        if (pluginRes) {
          res = pluginRes;
          if (res.ok) return res;
        } else {
          res = await installFromBundled(source.id, installOpts);
        }
      } else if (source.kind === 'npm') {
        const spec = source.spec.trim();
        if (!spec) return { ok: false, code: 'BAD_SOURCE', message: 'npm spec is required' };
        if (!ctx.runtimeSupervisor) {
          return { ok: false, code: 'UNAVAILABLE', message: 'plugin host is unavailable' };
        }
        const installSpec = spec.startsWith('npm:') ? spec : `npm:${spec}`;
        const row = await ctx.runtimeSupervisor.installPlugin(installSpec);
        const id =
          row && typeof row === 'object' && 'id' in row ? String((row as { id: unknown }).id) : '';
        if (!id) {
          return { ok: false, code: 'INSTALL_FAILED', message: 'plugin install did not return an id' };
        }
        return { ok: true, value: { id } };
      } else {
        return { ok: false, code: 'BAD_SOURCE', message: 'Unknown install source' };
      }
      // Discover + spawn the newly installed extension (consent overlay fires
      // first if it declares permissions — P3-D). Only on a successful install.
      if (res.ok) {
        // Mark the id BEFORE the reconcile so the child's first `ready` (this
        // spawn, or a later consent-gated one) fires the one-time `onInstall`
        // hook exactly once — and never on an ordinary boot/reload. Fire-and-
        // forget inside the host; the reconcile isn't held on install work.
        ctx.extProcessHost.markPendingInstall(res.value.id);
        await ctx.runDiskSync();
      }
      return res;
    },
    (err): Result<{ id: string }> => ({
      ok: false,
      code: 'INSTALL_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  // Uninstall: tear the live child down FIRST (so no process holds the files),
  // remove the containment-checked install dir, forget consent, then reconcile.
  // Renderer passes only an id (Rule #1); `uninstallExtension` re-derives +
  // confines the path (Rule #2) and refuses reserved built-ins.
  ctx.safeHandle(
    IPC.extensions.uninstall,
    async (id: string): Promise<Result<true>> => {
      // Fire the pre-removal hook FIRST, while the child is still alive and its
      // ctx (fs/exec/fetch) still works — the extension's chance to clean up
      // state it wrote OUTSIDE its dir. Bounded + never-throwing inside the host,
      // so a misbehaving hook can't wedge the uninstall.
      await ctx.extProcessHost.dispatchLifecycle(id, 'onUninstall');
      // Feed: resolve a LOCAL extension's project home BEFORE clearLocal drops the
      // pointer, so we can stamp the uninstall into that project's feed. The
      // source working dir is left on disk on uninstall, so the project persists.
      const localBefore = await getLocalRecord(id).catch(() => null);
      const localTitle = ctx.extensionEntries.find((e) => e.id === id)?.manifest?.title ?? id;
      await ctx.moduleRouter.teardown(id); // no-op for an unknown / already-dead id
      const res = await uninstallExtension(id, { reservedIds: ctx.builtinIds, log: ctx.logMainError });
      if (res.ok) {
        if (localBefore) {
          const proj = store.listProjects().find((p) => p.path === localBefore.workingDir);
          if (proj) {
            ctx.stampFeedEvent(
              proj.id,
              'extension-uninstalled',
              `Extension uninstalled: ${localTitle}`,
              `extension-uninstalled:${id}`
            );
          }
        }
        // Purge the extension's persistent `ctx.storage` KV (its `<id>.json`) so
        // a later reinstall of the same id starts clean instead of inheriting
        // the removed extension's state — the storage twin of removing the dir.
        ctx.moduleRouter.storageClear(id);
        // Remove any deployed `ext-<id>-*` skill dirs. `syncExtensionSkills` below
        // (via ctx.runDiskSync) only prunes contributors it's GIVEN — an uninstalled
        // extension is absent from the next `ctx.extensionEntries`, so it would never
        // see it again; this explicit call is the only place that cleans it up.
        await removeSkillsForExtension(id, ctx.logMainError);
        ctx.safeSend(IPC.skills.onChanged);
        // Forget consent so a later reinstall re-prompts; ignore a cleanup miss.
        await revokeConsent(id).catch((err) => ctx.logMainError(`revokeConsent ${id}`, err));
        // Drop the local-authored registry entry (no-op for a non-local ext).
        // The source project under the scratch workspace is deliberately LEFT on
        // disk — uninstalling the packaged copy shouldn't destroy the user's
        // authoring work; only the installed bytes + our pointer to it go.
        await clearLocal(id).catch((err) => ctx.logMainError(`clearLocal ${id}`, err));
        // Drop the git-provenance registry entry (no-op for a non-git ext).
        await clearGit(id).catch((err) => ctx.logMainError(`clearGit ${id}`, err));
        await ctx.runDiskSync();
      }
      return res;
    },
    (err): Result<true> => ({
      ok: false,
      code: 'UNINSTALL_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  // Create a LOCAL (in-app authored) extension. The renderer supplies only
  // display intent (name/description/kind) — ctx.createLocalExtension (module
  // scope) mints the id and derives every path (Rule 1).
  ctx.safeHandle(
    IPC.extensions.createLocal,
    (req: CreateLocalExtensionRequest) => ctx.createLocalExtension(req),
    (err): Result<CreateLocalExtensionResult> => ({
      ok: false,
      code: 'CREATE_LOCAL_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  // Adopt an EXISTING source directory into the local authoring workflow. Unlike
  // createLocal, the directory comes only from the OS picker, never renderer
  // text. Its current built artifact still crosses the normal pack/install seam;
  // local.json merely records where future reloads and Creator sessions operate.
  ctx.safeHandle(
    IPC.extensions.adoptLocal,
    async (): Promise<Result<CreateLocalExtensionResult>> => {
      const win = BrowserWindow.getFocusedWindow() ?? ctx.mainWindow();
      if (!win) return { ok: false, code: 'NO_WINDOW', message: 'No window to host the picker' };
      const pick = await dialog.showOpenDialog(win, {
        title: 'Import editable extension folder',
        properties: ['openDirectory']
      });
      if (pick.canceled || !pick.filePaths[0]) {
        return { ok: false, code: 'CANCELED', message: 'Import canceled' };
      }

      let workingDir: string;
      try {
        // Canonicalize the picker result before persisting it. Future reloads use
        // this main-owned path, and the dedicated project is rooted here.
        workingDir = realpathSync(pick.filePaths[0]);
      } catch {
        return { ok: false, code: 'BAD_SOURCE', message: 'Could not access the selected folder' };
      }
      return ctx.adoptLocalSource(workingDir);
    },
    (err): Result<CreateLocalExtensionResult> => ({
      ok: false,
      code: 'ADOPT_LOCAL_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  // Repository variant of "Open existing extension". The clone destination is
  // main-owned beneath the extension workspace; only a validated manifest dir
  // becomes editable local source. The source tree is intentionally retained on
  // success so the user can work directly in their Git checkout.
  ctx.safeHandle(
    IPC.extensions.adoptLocalGit,
    async (req: AdoptLocalExtensionGitRequest): Promise<Result<CreateLocalExtensionResult>> => {
      const cloned = await cloneProject({
        url: req?.url ?? '',
        ref: req?.ref,
        shallow: false,
        destBase: join(scratchWorkspaceRoot(), 'extensions'),
        onProgress: (line) => ctx.safeSend(IPC.extensions.installProgress, line)
      });
      if (!cloned.ok || !cloned.path) {
        return { ok: false, code: cloned.code ?? 'CLONE_FAILED', message: cloned.message ?? 'Could not clone repository' };
      }
      const located = await locateManifestDir(cloned.path, req?.subdir);
      if (!located.ok) return located;
      const adopted = await ctx.adoptLocalSource(located.value);
      if (!adopted.ok && !cloned.reused) {
        await rm(cloned.path, { recursive: true, force: true }).catch(() => {});
      }
      return adopted;
    },
    (err): Result<CreateLocalExtensionResult> => ({
      ok: false,
      code: 'ADOPT_LOCAL_GIT_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  // Reload a local extension from its source ("Reload from source"). Renderer
  // passes only an id; main RE-DERIVES the working dir from local.json — never
  // renderer/agent free-text (Rule 1). Re-pack + installFromDir (same gates,
  // via the shared ctx.packAndInstallLocal tail, module scope).
  ctx.safeHandle(
    IPC.extensions.reinstallLocal,
    async (id: string): Promise<Result<{ id: string }>> => {
      const record = await getLocalRecord(id);
      if (!record) {
        return { ok: false, code: 'NOT_LOCAL', message: `"${id}" is not a local extension` };
      }
      // Sanity: the source manifest's id must still match the registry key, so a
      // hand-edited manifest can't reinstall under a different id than we track.
      const declaredId = await readWorkingDirId(record.workingDir);
      if (declaredId !== id) {
        return {
          ok: false,
          code: 'ID_MISMATCH',
          message: `Source manifest id "${declaredId ?? '(none)'}" does not match "${id}"`
        };
      }
      return ctx.packAndInstallLocal(id, record.workingDir);
    },
    (err): Result<{ id: string }> => ({
      ok: false,
      code: 'REINSTALL_LOCAL_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  // Update a git extension from its source repo ("Update from repo"). Renderer
  // passes only an id; main RE-DERIVES {url, ref} from git.json — never
  // renderer/agent free-text (Rule 1). Re-clone + installFromGit (same gates +
  // scrub). Because installFromDir upgrades in place and consent now tracks
  // scopes, a widened update re-prompts before it can run. markGit refreshes the
  // resolved sha / installedAt (fail-closed as on first install).
  ctx.safeHandle(
    IPC.extensions.reinstallFromGit,
    async (id: string): Promise<Result<{ id: string }>> => {
      const record = await getGitRecord(id);
      if (!record) {
        return { ok: false, code: 'NOT_GIT', message: `"${id}" was not installed from a repository` };
      }
      const gitRes = await installFromGit(
        record.url,
        {
          ref: record.ref,
          onProgress: (line) => ctx.safeSend(IPC.extensions.installProgress, line)
        },
        { reservedIds: ctx.builtinIds, log: ctx.logMainError }
      );
      if (!gitRes.ok) return gitRes;
      // Guard against a repo that renamed its manifest id out from under us — an
      // update must land on the SAME id we tracked, not silently install a new one.
      if (gitRes.value.id !== id) {
        await uninstallExtension(gitRes.value.id, { reservedIds: ctx.builtinIds, log: ctx.logMainError }).catch(
          () => {}
        );
        return {
          ok: false,
          code: 'ID_MISMATCH',
          message: `Repository now declares id "${gitRes.value.id}", expected "${id}"`
        };
      }
      // Provenance refresh is best-effort on the UPDATE path (unlike the initial
      // install, which fails closed): installFromDir has ALREADY swapped the bytes
      // in place, and the id is still tracked in git.json from the first install —
      // a failed sha/installedAt refresh only leaves the provenance stale, not an
      // un-provenanced extension. Reconcile regardless so the running child never
      // lags the on-disk bytes just because the metadata write failed.
      const rec = await markGit(gitRes.value.id, {
        ...gitRes.value.provenance,
        installedAt: new Date().toISOString()
      });
      if (!rec.ok) {
        ctx.logMainError(
          'reinstallFromGit',
          `bytes updated but provenance refresh failed for "${id}": ${rec.message ?? 'unknown'}`
        );
      }
      await ctx.runDiskSync();
      return { ok: true, value: { id: gitRes.value.id } };
    },
    (err): Result<{ id: string }> => ({
      ok: false,
      code: 'REINSTALL_GIT_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  // Resolve a local extension's source working dir + scratch project so the
  // renderer can re-open the Creator agent ("Continue building"). Re-derived from
  // local.json (Rule 1) — the renderer passes only an id.
  ctx.safeHandle(
    IPC.extensions.localInfo,
    async (id: string): Promise<Result<CreateLocalExtensionResult>> => {
      const record = await getLocalRecord(id);
      if (!record) {
        return { ok: false, code: 'NOT_LOCAL', message: `"${id}" is not a local extension` };
      }
      // Re-derive (and self-heal) the dedicated Extensions-category project from
      // main's own record — never renderer/agent free-text (Rule 1). Seed the
      // display name from the installed entry's title, falling back to the id.
      const name = ctx.extensionEntries.find((e) => e.id === id)?.manifest?.title ?? id;
      const project = await ctx.registerExtensionProject(record.workingDir, name);
      return { ok: true, value: { id, workingDir: record.workingDir, projectId: project.id } };
    },
    (err): Result<CreateLocalExtensionResult> => ({
      ok: false,
      code: 'LOCAL_INFO_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  // Prepare a git-ready export of a local extension ("Prepare for sharing").
  // Renderer passes only an id; main RE-DERIVES the working dir from local.json
  // (Rule 1) and assembles <workingDir>/share (manifest + dist/ + README), then
  // reveals it so the user can commit + push.
  ctx.safeHandle(
    IPC.extensions.prepareShare,
    async (id: string): Promise<Result<{ shareDir: string }>> => {
      const record = await getLocalRecord(id);
      if (!record) {
        return { ok: false, code: 'NOT_LOCAL', message: `"${id}" is not a local extension` };
      }
      const res = await prepareShareDir(record.workingDir);
      if (!res.ok) return res;
      await shell.showItemInFolder(res.value.shareDir);
      return res;
    },
    (err): Result<{ shareDir: string }> => ({
      ok: false,
      code: 'PREPARE_SHARE_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  // Manual "Check for updates": apply every compatible, non-widening release for
  // the installed set (no-op unless the registry channel is configured). If any
  // were applied, reconcile so the new code spawns live.
  ctx.safeHandle(
    IPC.extensions.checkUpdates,
    async (): Promise<Result<ExtensionUpdateOutcome[]>> => {
      const outcomes = await maybeCheckRemoteUpdates(
        ctx.extensionEntries.map((e) => e.id),
        ctx.logMainError
      );
      if (outcomes.some((o) => o.status === 'updated')) await ctx.runDiskSync();
      return { ok: true, value: outcomes };
    },
    (err): Result<ExtensionUpdateOutcome[]> => ({
      ok: false,
      code: 'CHECK_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  // Browse the marketplace: first-party BUNDLED plugins (`plugins/`, offline)
  // unioned with leftover bundled disk extensions and the opt-in remote
  // registry (a remote release for an id wins over its bundled twin). Never
  // reaches the network by default — bundled rows are read from app resources.
  ctx.safeHandle(
    IPC.extensions.marketplaceList,
    async (): Promise<Result<MarketplaceEntry[]>> => {
      const pluginIds = createPluginStore({
        file: pluginStorePath(defaultPluginDataDir())
      })
        .list()
        .map((row) => row.id);
      const installedIds = [
        ...new Set([...ctx.extensionEntries.map((e) => e.id), ...pluginIds])
      ];
      const bundled = [
        ...listBundledPluginCatalog(defaultBundledRoot(), ctx.logMainError),
        ...(await listBundledCatalog(ctx.logMainError))
      ];
      const entries = await listMarketplace(
        installedIds,
        ctx.logMainError,
        undefined,
        bundled
      );
      return { ok: true, value: entries };
    },
    (err): Result<MarketplaceEntry[]> => ({
      ok: false,
      code: 'MARKETPLACE_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
}

