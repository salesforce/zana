import {
  persistSlackSurface,
  slackInteractionSurface,
} from "./interaction-surface.js";
import { featureEnabled, accessMessage, deliveryEnabled } from "./access.js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { ZccPluginApi } from "@zana-ai/zcc-plugin-sdk/server";
import {
  APP,
  CHANNEL,
  MEMBER,
  conversationKey,
  internalChannel,
  object,
  parseMention,
  plainSlack,
  decodeSlack,
  slackCall,
  TIMESTAMP,
  string,
  type Binding,
  type Config,
  type Delivery,
  type Receipt,
  type Route,
  type SlackConnection,
  type SlackAck,
  type Mention,
} from "./model.js";
import { AgentChat } from "./agent-chat.js";
import { launchPermission } from "./launch-permission.js";
import { parseThreadReply } from "./thread-replies.js";
import { SlackForms } from "./slack-forms.js";
import { DIRECT, ownerDirect } from "./model.js";
import { SlackHome } from "./home.js";
import { TaskEmbeds } from "./embed.js";
import { homeLink, sameRoute, bindingRoute, ownsBinding } from "./home-view.js";
import { applyAttentionEvents } from "./attention.js";
import {
  slackMarkdownBlocks,
  slackReadableText,
  compatibleSlackBlocks,
} from "./slack-markdown.js";
import {
  prepareDiagrams,
  diagramSources,
  diagramHash,
  diagramImages,
  renderMermaid,
  type DiagramRenderer,
} from "./mermaid.js";
import {
  activeStatusKind,
  activeStatusText,
  applyActivityEvents,
  statusKind,
  statusText,
  FORMATTING_NOTICE,
  type StatusKind,
} from "./status-view.js";
import {
  managedChannelName,
  MAX_PROJECT_CHANNELS,
  PROJECT_SYNC_BATCH_SIZE,
  normalizeChannelPrefix,
  projectChannelNames,
} from "./project-sync.js";
import { Store } from "./store.js";
import {
  parseRichResult,
  richResultBlocks,
  type RichResult,
} from "./rich-result.js";
import {
  localSetupLink,
  machines,
  type Settings,
  type ThreadEvent,
} from "./host.js";

export type SlackFactory = (
  appToken: string,
  botToken: string,
) => SlackConnection;
export class Bridge {
  config: Config;
  readonly home: SlackHome;
  readonly chat: AgentChat;
  readonly forms: SlackForms;
  readonly embeds: TaskEmbeds;
  connection = "Disconnected";
  private slack?: SlackConnection;
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private sending = false;
  private disposed = false;
  private connecting = false;
  private generation = 0;
  private channelNext = new Map<string, number>();
  private defaultProjectId?: string;
  private challenge?: { code: string; user: string; expires: number };
  private lastReconcile = 0;
  private continuationCursor = 0;
  private diagramAbort = new AbortController();
  private lastProjectSync = 0;
  private projectSyncing = false;
  private projectSyncStatus: {
    state: "idle" | "syncing" | "pending" | "complete" | "error";
    created: number;
    renamed: number;
    remaining: number;
    error: string;
    lastRun?: number;
  } = { state: "idle", created: 0, renamed: 0, remaining: 0, error: "" };
  constructor(
    readonly zcc: ZccPluginApi,
    readonly store: Store,
    private settings: Settings,
    private factory: SlackFactory,
    private remote?: () => Promise<
      | {
          client: SlackConnection;
          identity: { app: string; team: string; bot: string };
          owner: string;
        }
      | undefined
    >,
    hostedEmbedBase?: () => string | undefined,
    private diagramRenderer: DiagramRenderer = renderMermaid,
  ) {
    this.config = store.config();
    this.migrateProjectImports();
    store.recover();
    this.chat = new AgentChat({
      store,
      sdk: zcc.sdk,
      config: () => this.config,
      client: () => this.slack,
      accept: (m, ack) => this.acceptMention(m, ack),
      changed: () => this.changed(),
    });
    this.forms = new SlackForms({
      store,
      config: () => this.config,
      client: () => this.slack,
      route: (b) => this.routeFor(b),
      authorize: (b) => this.authorize(b.channel, b.root),
      accept: (m, ack) => this.acceptMention(m, ack),
      enqueue: (b, text, id) =>
        this.enqueue(b.key, b.channel, b.root, text, id, false, "operator"),
      changed: () => this.changed(),
    });
    this.embeds = new TaskEmbeds({
      hostedBase: hostedEmbedBase,
      routeFor: (b) => this.routeFor(b),
      authorize: (b) => this.authorize(b.channel, b.root),
      store,
      config: () => this.config,
      client: () => this.slack,
      save: () => this.save(),
      changed: () => this.changed(),
    });
    this.home = new SlackHome({
      store,
      setupUrl: localSetupLink(zcc.pluginId),
      config: () => this.config,
      client: () => this.slack,
      projects: () => this.zcc.sdk.projects.list(),
      providers: async () =>
        (await this.zcc.sdk.providers.list())
          .filter((p) => p.available && p.id.length <= 100)
          .map((p) => ({ id: p.id, name: p.displayName || p.id })),
      models: (hostId, providerId) => this.models({ hostId, providerId }),
      authorize: (channel, source) => this.authorize(channel, "", source),
      importProject: (projectId) =>
        this.importProjects({ projectIds: [projectId] }, true),
      accept: (m, ack) => this.acceptMention(m, ack),
      changed: () => this.changed(),
      enqueue: (l) => {
        const id = `home-root:${l.id}`;
        this.enqueue(
          `${l.team}:${l.app}:${l.route!.channel}:home:${l.id}`,
          l.route!.channel,
          l.replyRoot || "",
          `Task from Zana: ${l.task}`,
          id,
          true,
        );
        this.store.put("delivery", id, {
          ...this.store.get("delivery", id)!,
          requestedRoute: l.route,
          homeLaunchId: l.id,
        });
      },
    });
  }
  changed(): void {
    this.home?.changed();
    if (!this.disposed) this.zcc.realtime.publish("bridge.changed", {});
  }
  save(): void {
    this.embeds?.revoke();
    this.store.configure(this.config);
    this.changed();
  }
  async init(): Promise<void> {
    // Upgrade retained bindings before reconnecting, including currently active
    // conversations whose model has an older tool catalog. Store reads are capped.
    for (const binding of this.store.list("binding")) {
      try {
        await persistSlackSurface(this.zcc, binding.threadId);
      } catch {
        this.zcc.log.warn(
          "Could not restore remote presentation context for a retained conversation.",
        );
      }
    }
    await this.embeds.init();
    this.timer = setInterval(() => {
      void this.tick().catch(() => {
        this.connection = "Needs attention";
        this.changed();
      });
    }, 1000);
    this.timer.unref?.();
    if (this.config.enabled)
      await this.connect().catch(() => {
        this.connection = "Connection failed. Check setup and reconnect.";
        this.changed();
      });
  }
  async connect(): Promise<void> {
    if (this.disposed || this.connecting)
      throw new Error("Connection is already changing.");
    this.connecting = true;
    try {
      await this.disconnect();
      const generation = this.generation;
      const remote = await this.remote?.();
      const settings = await this.settings.get();
      const appToken = remote ? "" : string(settings.appToken, 500),
        botToken = remote ? "" : string(settings.botToken, 500),
        app = remote?.identity.app ?? string(settings.appId, 40);
      if (
        !remote &&
        (!appToken.startsWith("xapp-") ||
          !botToken.startsWith("xoxb-") ||
          !APP.test(app))
      )
        throw new Error(
          "Enter an app token, bot token, and Slack app ID in setup.",
        );
      const slack = remote?.client ?? this.factory(appToken, botToken);
      this.slack = slack;
      this.connection = "Connecting";
      this.changed();
      const auth = await slack.call("auth.test");
      if (
        !auth.ok ||
        typeof auth.team_id !== "string" ||
        !MEMBER.test(auth.user_id) ||
        !auth.bot_id
      )
        throw new Error("Slack bot identity could not be verified.");
      if (generation !== this.generation || this.disposed) return;
      const identity = { team: auth.team_id, app, bot: auth.user_id };
      if (
        remote &&
        (remote.identity.team !== identity.team ||
          remote.identity.bot !== identity.bot)
      )
        throw new Error("Connect identity changed.");
      if (
        this.config.identity &&
        JSON.stringify(this.config.identity) !== JSON.stringify(identity)
      )
        this.revokeOwnerAccess();
      this.config.identity = identity;
      if (remote) {
        if (this.config.owner && this.config.owner !== remote.owner)
          this.revokeOwnerAccess();
        this.config.owner = remote.owner;
      }
      this.config.workspaceName =
        typeof auth.team === "string" ? auth.team.slice(0, 100) : undefined;
      if (this.config.owner) {
        const member = object(
          await slack
            .call("users.info", { user: this.config.owner })
            .catch(() => ({})),
        );
        if (member.user?.id === this.config.owner)
          this.config.ownerName = String(
            member.user.profile?.display_name ||
              member.user.real_name ||
              member.user.name ||
              this.config.owner,
          ).slice(0, 100);
      }
      // Cache only the host-owned Default Project marker, never its display name.
      // Mentions must be durably acknowledged without a network lookup.
      const projects = await this.zcc.sdk.projects.list().catch(() => []);
      if (generation !== this.generation || this.disposed) return;
      const defaults = projects.filter(
        (p) => (p as { quickAgent?: boolean }).quickAgent === true,
      );
      this.defaultProjectId =
        defaults.length === 1 ? defaults[0].id : undefined;
      await slack.start(
        (body, ack) => this.receive(body, ack),
        (value) => {
          if (generation === this.generation && !this.disposed) {
            this.connection = value;
            this.changed();
          }
        },
      );
      if (generation !== this.generation || this.disposed) {
        await slack.close();
        return;
      }
      this.config.enabled = true;
      this.save();
      if (this.config.projectSync?.enabled)
        void this.syncProjects().catch(() => {});
    } catch {
      await this.disconnect();
      throw new Error(
        "Connection failed. Check Slack setup, Connect access, and network availability.",
      );
    } finally {
      this.connecting = false;
    }
  }
  async disconnect(): Promise<void> {
    this.defaultProjectId = undefined;
    this.embeds.reset();
    this.home.reset();
    this.chat.reset();
    this.generation++;
    this.challenge = undefined;
    const slack = this.slack;
    this.slack = undefined;
    this.config.enabled = false;
    this.connection = "Disconnected";
    this.save();
    if (slack) await slack.close();
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    clearInterval(this.timer);
    await this.chat.dispose();
    this.diagramAbort.abort();
    this.home.reset();
    this.disposed = true;
    this.generation++;
    clearInterval(this.timer);
    await this.embeds.dispose();
    this.challenge = undefined;
    const slack = this.slack;
    this.slack = undefined;
    if (slack) await slack.close();
  }
  pair(user: unknown): { code: string; expires: number } {
    if (!this.slack || !this.config.identity)
      throw new Error("Connect Slack first.");
    if (this.config.owner)
      throw new Error("An owner is already linked. Reset the owner first.");
    const id = string(user, 40);
    if (!MEMBER.test(id)) throw new Error("Enter your Slack member ID.");
    const code = randomBytes(12).toString("hex");
    const expires = Date.now() + 5 * 60000;
    this.challenge = { code, user: id, expires };
    return { code, expires };
  }
  private revokeOwnerAccess(): void {
    this.store.transaction(() => {
      // Preserve display/sharing preferences, but revoke all project and plugin consent.
      this.config = {
        identity: this.config.identity,
        ownerEpoch: randomUUID(),
        routes: [],
        enabled: false,
        embed: this.config.embed,
        slackAccess: this.config.slackAccess,
      };
      for (const l of this.store.list("homeLaunch", ["draft", "queued"]))
        this.store.put("homeLaunch", l.id, {
          ...l,
          state: "rejected",
          note: "Owner unlinked.",
        });
      for (const r of this.store.list("receipt", ["received", "queued"]))
        this.finish(r, "cancelled", "Owner was reset.");
      // finish() can queue status cards, so discard them after cancelling receipts.
      for (const d of this.store.list("delivery", ["queued"]))
        this.store.put("delivery", d.id, {
          ...d,
          state: "failed",
          note: "Owner unlinked.",
        });
      this.store.configure(this.config);
    });
  }
  async resetOwner(): Promise<void> {
    await this.disconnect();
    this.revokeOwnerAccess();
    this.save();
  }
  async models(input: unknown): Promise<{ id: string; name: string }[]> {
    const args = object(input),
      hostId = string(args.hostId, 100),
      providerId = string(args.providerId, 100);
    const [hosts, providers] = await Promise.all([
      machines(this.zcc),
      this.zcc.sdk.providers.list(),
    ]);
    if (
      !hosts.some((h) => h.id === hostId) ||
      !providers.some((p) => p.id === providerId && p.available)
    )
      throw new Error("Select a registered machine and available provider.");
    const result = await this.zcc.sdk.providers.models({ hostId, providerId });
    if (result.modelLoadError)
      throw new Error(
        "Could not load models from this machine. Check the provider in Zana and try again.",
      );
    return result.models
      .filter((m) => m.model && m.model !== "default")
      .map((m) => ({ id: m.model, name: m.model }));
  }
  async setMentionDefault(input: unknown): Promise<void> {
    const value = object(input).projectId;
    const projectId = value === "" ? "" : string(value, 100);
    const generation = this.generation;
    if (!this.config.owner) throw new Error("Link your Slack owner first.");
    if (projectId) {
      const projects = await this.zcc.sdk.projects.list();
      if (
        generation !== this.generation ||
        !projects.some((p) => p.id === projectId) ||
        !this.config.routes.some((r) => r.projectId === projectId && r.model)
      )
        throw new Error("Choose a connected Project with a configured model.");
    }
    this.config.mentionDefaultProjectId = projectId || undefined;
    this.save();
  }
  async addRoute(input: unknown): Promise<void> {
    const args = object(input),
      channel = string(args.channel, 40),
      projectId = string(args.projectId, 100),
      hostId = string(args.hostId, 100),
      providerId = string(args.providerId, 100),
      model = string(args.model, 300);
    const slack = this.slack,
      generation = this.generation;
    if (!slack || !this.config.owner || !CHANNEL.test(channel))
      throw new Error(
        "Connect Slack, link your owner, and enter a channel ID.",
      );
    if (
      this.config.routes.length >= 100 &&
      !this.config.routes.some((r) => r.channel === channel)
    )
      throw new Error("A maximum of 100 channels is supported.");
    const [projects, hosts, providers, info] = await Promise.all([
      this.zcc.sdk.projects.list(),
      machines(this.zcc),
      this.zcc.sdk.providers.list(),
      slack.call("conversations.info", { channel }),
    ]);
    if (
      !projects.some((p) => p.id === projectId) ||
      !hosts.some((h) => h.id === hostId) ||
      !providers.some((p) => p.id === providerId && p.available)
    )
      throw new Error(
        "Select a registered Project, machine, and available provider.",
      );
    if (
      !(await this.models({ hostId, providerId })).some((m) => m.id === model)
    )
      throw new Error(
        "Choose an available model for this machine and provider.",
      );
    if (!internalChannel(info.channel))
      throw new Error(
        "Invite the bot to an internal, unshared channel. Shared channels and DMs are not supported.",
      );
    if (generation !== this.generation)
      throw new Error("Connection changed. Try again.");
    const route: Route = {
      channel,
      name: String(info.channel.name || channel).slice(0, 100),
      projectId,
      hostId,
      providerId,
      model,
      summaries: args.summaries === true,
    };
    this.config.routes = [
      ...this.config.routes.filter((r) => r.channel !== channel),
      route,
    ];
    this.save();
  }
  /** Upgrades never opt a newly registered Project into Slack. */
  private migrateProjectImports(): void {
    const sync = this.config.projectSync;
    if (!sync || Array.isArray(sync.projectIds)) return;
    sync.projectIds = [
      ...new Set(
        (sync.channels || [])
          .filter((entry) =>
            this.config.routes.some(
              (route) =>
                route.channel === entry.channel &&
                route.projectId === entry.projectId,
            ),
          )
          .map((entry) => entry.projectId),
      ),
    ].slice(0, MAX_PROJECT_CHANNELS);
    sync.allowSlackImport = false;
    this.store.configure(this.config);
  }
  async importProjects(input: unknown, fromSlack = false): Promise<unknown> {
    const args = object(input),
      sync = this.config.projectSync;
    if (!sync?.enabled)
      throw new Error("Save import defaults in Zana for Slack first.");
    if (fromSlack && !featureEnabled(this.config, "imports"))
      throw new Error(
        "Enable imports from Slack in Zana for Slack settings first.",
      );
    if (this.projectSyncing)
      throw new Error("An import is in progress. Try again shortly.");
    const ids = args.projectIds;
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > MAX_PROJECT_CHANNELS ||
      ids.some((id) => typeof id !== "string" || !id || id.length > 100) ||
      new Set(ids).size !== ids.length
    )
      throw new Error("Choose 1–250 distinct registered Projects.");
    const generation = this.generation;
    const projects = await this.zcc.sdk.projects.list();
    if (ids.some((id) => !projects.some((project) => project.id === id)))
      throw new Error("A selected Project is no longer registered.");
    if (
      generation !== this.generation ||
      sync !== this.config.projectSync ||
      this.projectSyncing ||
      !this.config.enabled ||
      (fromSlack && !featureEnabled(this.config, "imports"))
    )
      throw new Error("Connection or import settings changed. Try again.");
    this.migrateProjectImports();
    const selected = [...new Set([...(sync.projectIds || []), ...ids])];
    if (selected.length > MAX_PROJECT_CHANNELS)
      throw new Error("Up to 250 Projects can be imported.");
    sync.projectIds = selected;
    this.save();
    return this.syncProjects();
  }
  async configureProjectSync(input: unknown): Promise<unknown> {
    const args = object(input);
    if (this.projectSyncing)
      throw new Error("An import is in progress. Try again shortly.");
    this.migrateProjectImports();
    const generation = this.generation;
    if (args.enabled === false) {
      if (this.config.projectSync)
        this.config.projectSync = {
          ...this.config.projectSync,
          enabled: false,
        };
      this.projectSyncStatus = {
        state: "idle",
        created: 0,
        renamed: 0,
        remaining: 0,
        error: "",
      };
      this.save();
      return this.projectSyncStatus;
    }
    const hostId = string(args.hostId, 100),
      providerId = string(args.providerId, 100),
      model = string(args.model, 300),
      channelPrefix = normalizeChannelPrefix(args.channelPrefix);
    const [hosts, providers, models] = await Promise.all([
      machines(this.zcc),
      this.zcc.sdk.providers.list(),
      this.models({ hostId, providerId }),
    ]);
    if (
      !hosts.some((host) => host.id === hostId) ||
      !providers.some(
        (provider) => provider.id === providerId && provider.available,
      ) ||
      !models.some((entry) => entry.id === model)
    )
      throw new Error("Choose an available machine, provider, and model.");
    if (generation !== this.generation || this.projectSyncing)
      throw new Error("Connection or import settings changed. Try again.");
    this.config.projectSync = {
      enabled: true,
      projectIds: this.config.projectSync?.projectIds || [],
      allowSlackImport: args.allowSlackImport === true,
      channelPrefix,
      hostId,
      providerId,
      model,
      summaries: args.summaries === true,
      pending:
        this.config.projectSync?.pending?.slice(0, MAX_PROJECT_CHANNELS) || [],
      channels:
        this.config.projectSync?.channels?.slice(0, MAX_PROJECT_CHANNELS) || [],
    };
    this.save();
    return this.syncProjects();
  }
  async syncProjects(): Promise<unknown> {
    if (this.projectSyncing) return this.projectSyncStatus;
    this.migrateProjectImports();
    const sync = this.config.projectSync;
    const slack = this.slack;
    if (!sync?.enabled || !slack || !this.config.owner || !this.config.enabled)
      throw new Error("Connect Slack and save import defaults first.");
    this.projectSyncing = true;
    this.lastProjectSync = Date.now();
    this.projectSyncStatus = {
      state: "syncing",
      created: 0,
      renamed: 0,
      remaining: 0,
      error: "",
    };
    this.changed();
    const generation = this.generation;
    const assertCurrent = () => {
      if (
        generation !== this.generation ||
        this.disposed ||
        this.config.projectSync !== sync ||
        !sync.enabled ||
        !this.config.enabled
      )
        throw new Error("Connection changed during Project import.");
    };
    let created = 0,
      renamed = 0,
      processed = 0;
    try {
      const [availableProjects, hosts, providers, models] = await Promise.all([
        this.zcc.sdk.projects.list(),
        machines(this.zcc),
        this.zcc.sdk.providers.list(),
        this.models({ hostId: sync.hostId, providerId: sync.providerId }),
      ]);
      assertCurrent();
      const projects = availableProjects.filter((project) =>
        sync.projectIds?.includes(project.id),
      );
      if (projects.length > MAX_PROJECT_CHANNELS)
        throw new Error(
          `Project import supports up to ${MAX_PROJECT_CHANNELS} Projects.`,
        );
      if (
        !hosts.some((host) => host.id === sync.hostId) ||
        !providers.some(
          (provider) => provider.id === sync.providerId && provider.available,
        ) ||
        !models.some((entry) => entry.id === sync.model)
      )
        throw new Error(
          "The import machine, provider, or model is no longer available.",
        );
      for (const project of projects) {
        if (
          generation !== this.generation ||
          this.disposed ||
          !this.config.projectSync?.enabled
        )
          throw new Error("Connection changed during Project sync.");
        const managed = this.config.projectSync.channels?.find(
          (entry) => entry.projectId === project.id,
        );
        const managedRoute =
          managed &&
          this.config.routes.find(
            (route) =>
              route.projectId === project.id &&
              route.channel === managed.channel,
          );
        const prefix = normalizeChannelPrefix(sync.channelPrefix);
        const [preferredName, fallbackName] = projectChannelNames(
          project,
          prefix,
        );
        const namingCurrent =
          managed?.prefix === prefix &&
          (managed.name === preferredName ||
            (managed.collision === true && managed.name === fallbackName));
        if (managed && managedRoute && !namingCurrent) {
          if (processed >= PROJECT_SYNC_BATCH_SIZE) break;
          let name = preferredName;
          let collision = false;
          let value = await slack.call("conversations.rename", {
            channel: managed.channel,
            name,
          });
          assertCurrent();
          if (!value.ok && value.error === "name_taken") {
            collision = true;
            name = fallbackName;
            value =
              managed.name === fallbackName
                ? {
                    ok: true,
                    channel: { id: managed.channel, name: managed.name },
                  }
                : await slack.call("conversations.rename", {
                    channel: managed.channel,
                    name,
                  });
          }
          assertCurrent();
          if (
            !value.ok ||
            value.channel?.id !== managed.channel ||
            !managedChannelName(value.channel?.name || name)
          )
            throw new Error(
              value.error === "missing_scope"
                ? "Slack needs the groups:write scope before it can rename private Project channels."
                : value.error === "name_taken"
                  ? `Slack already has both generated names for ${project.name}. Change the optional channel prefix and try again.`
                  : "Slack could not rename a private Project channel.",
            );
          const actualName = String(value.channel?.name || name).slice(0, 80);
          const updated = {
            ...managed,
            name: actualName,
            prefix,
            collision,
          };
          this.config.projectSync.channels = [
            ...(this.config.projectSync.channels || []).filter(
              (entry) => entry.projectId !== project.id,
            ),
            updated,
          ].slice(-MAX_PROJECT_CHANNELS);
          this.config.routes = this.config.routes.map((route) =>
            route.channel === managed.channel
              ? { ...route, name: actualName }
              : route,
          );
          if (actualName !== managed.name) renamed++;
          processed++;
          this.save();
          continue;
        }
        if (managed && managedRoute) continue;
        if (processed >= PROJECT_SYNC_BATCH_SIZE) break;
        let pending =
          this.config.projectSync.pending?.find(
            (entry) => entry.projectId === project.id,
          ) || managed;
        if (!pending) {
          let name = preferredName;
          let collision = false;
          let value = await slack.call("conversations.create", {
            name,
            is_private: true,
          });
          assertCurrent();
          if (!value.ok && value.error === "name_taken") {
            collision = true;
            name = fallbackName;
            value = await slack.call("conversations.create", {
              name,
              is_private: true,
            });
          }
          assertCurrent();
          if (!value.ok || !CHANNEL.test(value.channel?.id))
            throw new Error(
              value.error === "missing_scope"
                ? "Slack needs the groups:write scope before it can create private Project channels."
                : value.error === "name_taken"
                  ? `Slack already has both generated names for ${project.name}. Change the optional channel prefix and try again.`
                  : "Slack could not create a private Project channel.",
            );
          pending = {
            projectId: project.id,
            channel: value.channel.id,
            name,
            prefix,
            collision,
          };
          this.config.projectSync.pending = [
            ...(this.config.projectSync.pending || []).filter(
              (entry) => entry.projectId !== project.id,
            ),
            pending,
          ].slice(-MAX_PROJECT_CHANNELS);
          this.save();
        }
        if (!CHANNEL.test(pending.channel) || !managedChannelName(pending.name))
          throw new Error("A pending Project channel is invalid.");
        const invited = await slack.call("conversations.invite", {
          channel: pending.channel,
          users: this.config.owner,
        });
        assertCurrent();
        if (!invited.ok && invited.error !== "already_in_channel")
          throw new Error(
            "Slack could not add you to the private Project channel.",
          );
        const info = await slack.call("conversations.info", {
          channel: pending.channel,
        });
        assertCurrent();
        if (!internalChannel(info.channel) || info.channel?.is_private !== true)
          throw new Error(
            "The created Project channel is not private and internal.",
          );
        this.config.routes = [
          ...this.config.routes.filter(
            (route) => route.channel !== pending!.channel,
          ),
          {
            channel: pending.channel,
            name: String(info.channel.name || pending.name).slice(0, 100),
            projectId: project.id,
            hostId: sync.hostId,
            providerId: sync.providerId,
            model: sync.model,
            summaries: sync.summaries,
          },
        ];
        this.config.projectSync.channels = [
          ...(this.config.projectSync.channels || []).filter(
            (entry) => entry.projectId !== project.id,
          ),
          pending,
        ].slice(-MAX_PROJECT_CHANNELS);
        this.config.projectSync.pending = (
          this.config.projectSync.pending || []
        ).filter((entry) => entry.projectId !== project.id);
        created++;
        processed++;
        this.save();
      }
      const remaining = projects.filter((project) => {
        const managed = this.config.projectSync?.channels?.find(
          (entry) => entry.projectId === project.id,
        );
        const prefix = normalizeChannelPrefix(
          this.config.projectSync?.channelPrefix,
        );
        const [preferredName, fallbackName] = projectChannelNames(
          project,
          prefix,
        );
        return (
          !managed ||
          !(
            managed.prefix === prefix &&
            (managed.name === preferredName ||
              (managed.collision === true && managed.name === fallbackName))
          ) ||
          !this.config.routes.some(
            (route) =>
              route.projectId === project.id &&
              route.channel === managed.channel,
          )
        );
      }).length;
      this.projectSyncStatus = {
        state: remaining ? "pending" : "complete",
        created,
        renamed,
        remaining,
        error: "",
        lastRun: Date.now(),
      };
      this.changed();
      return this.projectSyncStatus;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Project import failed.";
      this.projectSyncStatus = {
        state: "error",
        created,
        renamed,
        remaining: this.projectSyncStatus.remaining,
        error: message,
        lastRun: Date.now(),
      };
      this.changed();
      throw new Error(message);
    } finally {
      this.projectSyncing = false;
    }
  }
  removeRoute(channel: unknown): void {
    const id = string(channel, 40);
    if (this.projectSyncing)
      throw new Error("An import is in progress. Try again shortly.");
    this.migrateProjectImports();
    this.config.routes = this.config.routes.filter((r) => r.channel !== id);
    const managed = this.config.projectSync?.channels?.find(
      (entry) => entry.channel === id,
    );
    if (managed && this.config.projectSync)
      this.config.projectSync.projectIds =
        this.config.projectSync.projectIds?.filter(
          (projectId) => projectId !== managed.projectId,
        );
    this.save();
  }
  async channels(): Promise<{ id: string; name: string }[]> {
    if (!this.slack) throw new Error("Connect Slack first.");
    const slack = this.slack,
      generation = this.generation;
    const channels: { id: string; name: string }[] = [];
    let cursor = "";
    for (let page = 0; page < 5; page++) {
      const result = await slack.call("conversations.list", {
        types: "public_channel,private_channel",
        exclude_archived: true,
        limit: 200,
        ...(cursor ? { cursor } : {}),
      });
      if (!result.ok)
        throw new Error(
          "Could not load channels. Enter the channel ID instead.",
        );
      for (const c of (Array.isArray(result.channels)
        ? result.channels
        : []
      ).slice(0, 200))
        if (internalChannel(c))
          channels.push({
            id: c.id,
            name: String(c.name || c.id).slice(0, 100),
          });
      cursor = result.response_metadata?.next_cursor || "";
      if (!cursor) break;
    }
    if (generation !== this.generation)
      throw new Error("Connection changed. Try again.");
    return channels;
  }
  async testChannel(channel: unknown): Promise<void> {
    const route = this.config.routes.find((r) => r.channel === channel);
    if (
      !route ||
      !this.config.enabled ||
      !this.config.owner ||
      !this.config.identity
    )
      throw new Error("Connect Slack and save this channel first.");
    const id = this.config.identity;
    this.enqueue(
      `${id.team}:${id.app}:${route.channel}:test`,
      route.channel,
      "",
      "Zana is connected. Mention @Zana with a small task to test the full journey. Agents run on the machine selected in Zana; keep it awake. Execution permissions are reviewed in Zana.",
      undefined,
      true,
    );
  }
  async snapshot(): Promise<unknown> {
    const [projects, hosts, providers] = await Promise.all([
      this.zcc.sdk.projects.list(),
      machines(this.zcc),
      this.zcc.sdk.providers.list(),
    ]);
    return {
      connection: this.connection,
      embed: this.embeds.snapshot(),
      conversationalChatReady: !!this.zcc.sdk.assistant?.complete,
      reportInboxReady:
        !!this.zcc.sdk.assistant?.complete &&
        !!this.zcc.sdk.inbox.search &&
        !!this.zcc.sdk.inbox.read,
      home: {
        url: homeLink(this.config),
        lastPublished: this.home.lastPublished,
        error: this.home.error,
      },
      homeLaunches: this.store
        .list("homeLaunch", ["queued", "needs-review", "rejected"], 50)
        .map(({ routes, task, ...l }) => ({ ...l, title: task.slice(0, 100) })),
      config: this.config,
      projectSync: this.projectSyncStatus,
      projects,
      hosts,
      providers: providers
        .filter((p) => p.available)
        .map((p) => ({ id: p.id, name: p.displayName || p.id })),
      requests: [
        ...new Map(
          [
            ...this.store.list("receipt", ["needs-review"], 100),
            ...this.store.list("receipt", undefined, 50),
          ].map((r) => [r.id, r]),
        ).values(),
      ].map(({ text, ...r }) => ({
        ...r,
        text: text.startsWith("link ") ? "[Owner verification]" : text,
      })),
      surfaceLog: [
        ...this.store.list("chatTurn", ["uncertain", "failed"], 8).map((t) => ({
          id: t.id,
          title: "Private conversation request",
          state: t.state,
          note:
            t.note ||
            "Reply delivery was not confirmed. Inspect Slack before sending another request.",
        })),
        ...this.store.list("agentChat", undefined, 8).map((s) => ({
          id: s.id,
          title: "Private agent chat",
          state: s.state,
          note: s.note,
        })),
        ...this.store.list("canvas", undefined, 8).map((s) => ({
          id: s.id,
          title: s.title,
          state: s.state,
          note: s.note,
          url: s.url,
        })),
      ],
      bindings: this.store.list("binding", undefined, 100),
      deliveries: [
        ...new Map(
          [
            ...this.store.list("delivery", ["uncertain"], 50),
            ...this.store.list("delivery", undefined, 50),
          ].map((d) => [d.id, d]),
        ).values(),
      ],
    };
  }
  async receive(body: unknown, ack: SlackAck): Promise<void> {
    if (!this.config.identity || this.disposed) return;
    const payload = object(body);
    if (JSON.stringify(payload).length > 256 * 1024) {
      await ack();
      return;
    }
    const event = payload.event;
    if (
      payload.type === "event_callback" &&
      event?.type === "message" &&
      DIRECT.test(event.channel) &&
      !event.bot_id &&
      !event.subtype &&
      payload.team_id === this.config.identity.team &&
      payload.api_app_id === this.config.identity.app &&
      event.user === this.config.owner &&
      TIMESTAMP.test(event.ts) &&
      Math.abs(Date.now() - Number(event.ts) * 1000) < 300000 &&
      typeof event.text === "string" &&
      event.text.trim() &&
      event.text.length <= 2000 &&
      (this.home.conversation(event.channel, event.thread_ts || event.ts) ||
        this.config.agentChatEnabled !== true)
    ) {
      const m: Mention = {
        id: String(payload.event_id || `dm:${event.channel}:${event.ts}`),
        team: payload.team_id,
        app: payload.api_app_id,
        channel: event.channel,
        user: event.user,
        root: event.thread_ts || event.ts,
        ts: event.ts,
        text: decodeSlack(
          event.text.split(`<@${this.config.identity.bot}>`).join(""),
        ).trim(),
      };
      if (this.home.conversation(m.channel, m.root)) {
        if (!m.text) m.text = "status";
        await this.acceptMention(m, ack);
      } else await this.home.offer(m, ack);
      return;
    }
    if (await this.chat.handle(payload, ack)) return;
    if (await this.forms.handle(payload, ack)) return;
    if (await this.embeds.handle(payload, ack)) return;
    if (await this.home.handle(payload, ack)) return;
    const m =
      payload.type === "block_actions"
        ? this.actionMention(payload)
        : parseMention(body, this.config.identity) ||
          parseThreadReply(body, this.config, (key) => {
            const binding = this.store.get("binding", key);
            return binding && this.routeFor(binding) ? binding : undefined;
          });
    if (
      !m ||
      (m.user !== this.config.owner && m.user !== this.challenge?.user)
    ) {
      await ack();
      return;
    }
    if (m.user === this.config.owner && !m.text) {
      if (this.store.get("binding", conversationKey(m))) m.text = "status";
      else {
        await this.home.offer(m, ack);
        return;
      }
    }
    if (
      m.user === this.config.owner &&
      !this.destinationRoute(m.channel, m.root) &&
      !m.text.startsWith("link ")
    ) {
      if (!this.useDefaultProject(m)) {
        await this.home.offer(m, ack);
        return;
      }
    }
    await this.acceptMention(m, ack);
  }
  private async acceptMention(m: Mention, ack: SlackAck): Promise<void> {
    if (this.store.get("receipt", m.id)) {
      await ack();
      return;
    }
    // Persist before acknowledgement. A storage failure deliberately leaves Slack free to retry.
    const stale = Date.now() - Number(m.ts) * 1000 > 30 * 60000;
    const overloaded =
      this.store.list(
        "receipt",
        ["received", "queued", "dispatching", "needs-review"],
        101,
      ).length >= 100;
    const r: Receipt = {
      ...m,
      key: conversationKey(m),
      created: Date.now(),
      ...(this.home.conversation(m.channel, m.root)
        ? { requestedRoute: this.destinationRoute(m.channel, m.root) }
        : {}),
      state: stale || overloaded ? "rejected" : "received",
      note: stale ? "Request expired." : overloaded ? "Queue is full." : "",
    };
    this.store.insert(r);
    if (r.state === "rejected")
      this.status(r, r.note + " Send a new request when ready.");
    await ack();
    this.changed();
    // The timer admits durable receipts. No agent work occurs in the ACK path.
  }
  private actionMention(
    p: Record<string, any>,
  ): ReturnType<typeof parseMention> {
    const a =
      Array.isArray(p.actions) && p.actions.length === 1
        ? p.actions[0]
        : undefined;
    if (
      !a ||
      !["bridge_stop", "bridge_mute", "bridge_unmute"].includes(a.action_id) ||
      p.team?.id !== this.config.identity?.team ||
      p.api_app_id !== this.config.identity?.app ||
      p.user?.id !== this.config.owner ||
      !TIMESTAMP.test(a.action_ts) ||
      typeof a.value !== "string" ||
      a.value.length > 150
    )
      return null;
    const d = this.store.get("delivery", a.value);
    if (
      !d?.card ||
      !d.ts ||
      d.ts !== p.container?.message_ts ||
      d.channel !== p.channel?.id ||
      d.channel !== p.container?.channel_id ||
      !d.key.startsWith(`${p.team.id}:${p.api_app_id}:`)
    )
      return null;
    return {
      id:
        "action:" +
        createHash("sha256")
          .update(`${a.value}:${a.action_id}:${a.action_ts}`)
          .digest("hex"),
      team: p.team.id,
      app: p.api_app_id,
      user: p.user.id,
      channel: d.channel,
      ts: a.action_ts,
      root: d.root,
      text: a.action_id.slice(7),
    };
  }
  private status(r: Receipt, text: string, kind?: StatusKind): void {
    if (
      r.text.startsWith("link ") ||
      r.text === "[Owner verification]" ||
      r.team !== this.config.identity?.team ||
      r.app !== this.config.identity?.app ||
      r.user !== this.config.owner ||
      !this.destinationRoute(r.channel, r.root)
    )
      return;
    const id = `status:${r.id}`;
    const previous = this.store.get("delivery", id);
    if (previous?.remove || previous?.state === "removed") return;
    const answer = this.turnReply(r);
    const completed = this.completedReceipt(r);
    if (completed && answer?.state === "sent") {
      this.queueStatusRemoval(previous);
      return;
    }
    const formatting =
      answer?.origin === "agent" &&
      ["queued", "sending"].includes(answer.state) &&
      diagramSources(answer).length > 0 &&
      (completed || r.state === "running") &&
      kind !== "stopping" &&
      !this.store.get("binding", r.key)?.stopping;
    if (
      completed &&
      !formatting &&
      ["queued", "sending"].includes(answer?.state || "")
    )
      return;
    // Preserve the working phase when the turn ends before formatting/delivery.
    const content =
      completed && formatting
        ? previous?.text.split(`\n\n${FORMATTING_NOTICE}`)[0] ||
          statusText("working", "Working…")
        : statusText(
            kind ||
              (completed
                ? "attention"
                : statusKind(r, this.store.get("binding", r.key))),
            text,
          );
    this.upsertMessage(
      id,
      r.key,
      r.channel,
      r.root,
      content + (formatting ? `\n\n${FORMATTING_NOTICE}` : ""),
      "status",
      r.id,
      true,
    );
    const d = this.store.get("delivery", id)!;
    this.store.put("delivery", id, {
      ...d,
      control:
        ["rejected", "cancelled", "needs-review"].includes(r.state) ||
        ["stop", "mute", "unmute", "pause", "resume"].includes(r.text),
    });
  }
  private refreshFormattingStatus(d?: Delivery): void {
    if (
      this.disposed ||
      !this.config.enabled ||
      d?.origin !== "agent" ||
      !d.requestId
    )
      return;
    const r = this.store.get("receipt", d.requestId),
      b = this.store.get("binding", d.key);
    if (!r || !b || b.paused || b.stopping || (b.active && b.active !== r.id))
      return;
    if (this.completedReceipt(r)) this.status(r, this.endedText(r));
    else if (r.state === "running") this.status(r, activeStatusText(b));
  }
  private upsertMessage(
    id: string,
    key: string,
    channel: string,
    root: string,
    text: string,
    origin: Delivery["origin"],
    requestId: string,
    card = false,
    result?: RichResult,
  ): void {
    const old = this.store.get("delivery", id);
    if (old) {
      if (
        old.text === text &&
        JSON.stringify(old.result) === JSON.stringify(result)
      )
        return;
      this.store.put("delivery", id, {
        ...old,
        text: text.slice(0, 2000),
        result,
        revision: (old.revision || 1) + 1,
        imageRetries: 0,
        presentation: undefined,
        modified: Date.now(),
        state: ["uncertain", "reviewed", "sending"].includes(old.state)
          ? old.state
          : "queued",
        next: Date.now(),
      });
    } else {
      this.enqueue(key, channel, root, text, id, card, origin);
      this.store.put("delivery", id, {
        ...this.store.get("delivery", id)!,
        card,
        requestId,
        revision: 1,
        result,
      });
    }
    this.changed();
  }
  private completedReceipt(r: Receipt): boolean {
    return (
      r.state === "settled" &&
      (r.outcome === "completed" ||
        (!r.outcome && this.store.get("binding", r.key)?.state === "idle"))
    );
  }
  private turnReply(r: Receipt): Delivery | undefined {
    return (
      this.store.get("delivery", `answer:${r.id}`) ||
      this.store.get("delivery", `question:${r.id}`)
    );
  }
  private unansweredContinuation(b: Binding): Receipt | undefined {
    const r = b.lastRequest
      ? this.store.get("receipt", b.lastRequest)
      : undefined;
    return r?.state === "settled" &&
      r.outcome === "completed" &&
      this.turnReply(r)?.state !== "sent"
      ? r
      : undefined;
  }
  private endedText(r: Receipt): string {
    const question = this.store.get("question", `question:${r.id}`);
    if (
      this.config.questionsEnabled === true &&
      featureEnabled(this.config, "followups") &&
      question?.state === "waiting" &&
      question.expires > Date.now()
    )
      return "Answer the questions here to continue.";
    const answer = this.store.get("delivery", `answer:${r.id}`);
    return answer?.state === "sent"
      ? "Answer delivered."
      : answer && ["queued", "sending"].includes(answer.state)
        ? "Answer awaiting Slack delivery."
        : answer
          ? "Answer delivery needs attention. Check Zana."
          : "No answer shared. Ask me for a summary here, or check Zana for the result.";
  }
  private finish(r: Receipt, state: Receipt["state"], note: string): void {
    const b = this.store.get("binding", r.key);
    const outcome =
      state === "settled" && !r.outcome && b?.lastRequest === r.id
        ? b.state === "idle"
          ? "completed"
          : b.state === "failed"
            ? "failed"
            : b.state === "stopped"
              ? "stopped"
              : undefined
        : r.outcome;
    const updated: Receipt = { ...r, state, note, outcome };
    this.store.put("receipt", r.id, updated);
    if (!["dispatching"].includes(state)) this.status(updated, note);
    this.changed();
  }
  destinationRoute(channel: string, root: string): Route | undefined {
    const key = `${this.config.identity?.team}:${this.config.identity?.app}:${channel}:${root}`;
    if (this.store.get("launchConversation", key))
      return this.home.conversation(channel, root)?.route;
    return this.chat.route(channel, root);
  }
  private useDefaultProject(m: Mention): boolean {
    const key = conversationKey(m);
    // A revoked conversation must never silently switch to another Project.
    if (
      this.store.get("launchConversation", key) ||
      !this.config.enabled ||
      !featureEnabled(this.config, "launch") ||
      !CHANNEL.test(m.channel) ||
      !m.text ||
      m.text.length > 2000 ||
      Math.abs(Date.now() - Number(m.ts) * 1000) > 300000 ||
      !(this.config.mentionDefaultProjectId || this.defaultProjectId)
    )
      return false;
    const source = this.config.routes.find(
      (r) =>
        r.projectId ===
          (this.config.mentionDefaultProjectId || this.defaultProjectId) &&
        !!r.model,
    );
    if (!source) return false;
    this.store.put("launchConversation", key, {
      id: key,
      state: "ready",
      ownerEpoch: this.config.ownerEpoch,
      team: m.team,
      app: m.app,
      user: m.user,
      source: { ...source },
      route: { ...source, channel: m.channel, sourceChannel: source.channel },
    });
    return true;
  }
  routeFor(b: Binding): Route | undefined {
    if (b.user && b.user !== this.config.owner) return;
    const route = bindingRoute(this.config, b);
    if (!route) return;
    if (b.launch) return route;
    if (b.sourceChannel) {
      const chat = this.destinationRoute(b.channel, b.root);
      return chat &&
        chat.sourceChannel === b.sourceChannel &&
        chat.projectId === b.projectId &&
        chat.hostId === b.hostId &&
        chat.providerId === b.providerId
        ? chat
        : undefined;
    }
    return route;
  }
  private async authorize(
    channel: string,
    root = "",
    sourceChannel?: string,
  ): Promise<boolean> {
    if (!this.slack) return false;
    const info = await this.slack.call("conversations.info", { channel });
    const sourceId =
      sourceChannel || this.destinationRoute(channel, root)?.sourceChannel;
    if (
      !DIRECT.test(channel) &&
      (!internalChannel(info.channel) || info.channel.id !== channel)
    )
      return false;
    if (
      DIRECT.test(channel) &&
      (!sourceId || !ownerDirect(info.channel, this.config.owner))
    )
      return false;
    if (!sourceId || sourceId === channel) return !DIRECT.test(channel);
    const source = await this.slack.call("conversations.info", {
      channel: sourceId,
    });
    return internalChannel(source.channel) && source.channel.id === sourceId;
  }
  private enqueue(
    key: string,
    channel: string,
    root: string,
    text: string,
    id: string = randomUUID(),
    control = false,
    origin: Delivery["origin"] = "status",
  ): void {
    if (this.store.get("delivery", id)) return;
    if (
      this.store.list("delivery", ["queued", "sending", "uncertain"], 501)
        .length >= 500
    )
      throw new Error(
        "Delivery log needs attention before more messages can be queued.",
      );
    this.store.put("delivery", id, {
      control,
      origin,
      id,
      key,
      channel,
      root,
      text: text.slice(0, 2000),
      state: "queued",
      created: Date.now(),
      next: Date.now(),
      attempts: 0,
      note: "",
    });
    this.changed();
  }
  private async admit(r: Receipt): Promise<void> {
    const generation = this.generation;
    if (
      r.team !== this.config.identity?.team ||
      r.app !== this.config.identity?.app
    )
      return this.finish(r, "rejected", "Slack installation changed.");
    if (Date.now() - r.created > 30 * 60000)
      return this.finish(
        r,
        "rejected",
        "Request expired before admission. Send a new request.",
      );
    if (r.text.startsWith("link ")) {
      const challenge = this.challenge;
      this.finish(
        { ...r, text: "[Owner verification]" },
        "rejected",
        "Owner verification failed or expired.",
      );
      if (
        !challenge ||
        challenge.expires < Date.now() ||
        r.user !== challenge.user ||
        r.text !== "link " + challenge.code ||
        this.config.owner ||
        !this.slack
      )
        return;
      const generation = this.generation,
        info = await this.slack.call("users.info", { user: r.user });
      if (
        generation !== this.generation ||
        info.user?.id !== r.user ||
        info.user?.team_id !== this.config.identity?.team ||
        info.user?.is_bot !== false ||
        info.user?.deleted !== false ||
        info.user?.is_restricted !== false ||
        info.user?.is_ultra_restricted !== false ||
        !(await this.authorize(r.channel, r.root))
      )
        return;
      if (
        generation !== this.generation ||
        this.disposed ||
        this.challenge !== challenge
      )
        return;
      this.config.owner = r.user;
      this.config.ownerName = String(
        info.user.profile?.display_name ||
          info.user.real_name ||
          info.user.name ||
          r.user,
      ).slice(0, 100);
      this.challenge = undefined;
      this.save();
      this.finish(
        { ...r, text: "[Owner verification]" },
        "settled",
        "Owner linked. Add a channel mapping in Zana.",
      );
      return;
    }
    const route = this.destinationRoute(r.channel, r.root);
    if (!route || r.user !== this.config.owner)
      return this.finish(r, "rejected", "Owner or channel is not authorized.");
    if (r.requestedRoute && !sameRoute(r.requestedRoute, route))
      return this.finish(
        r,
        "rejected",
        "Destination changed after the launch request. Start a new request from Home or /zana.",
      );
    if (!(await this.authorize(r.channel, r.root)))
      return this.finish(
        r,
        "rejected",
        "Channel must be internal, unshared, and include the bot.",
      );
    if (generation !== this.generation || this.disposed) return;
    if (
      !this.destinationRoute(r.channel, r.root) ||
      !sameRoute(this.destinationRoute(r.channel, r.root)!, route) ||
      this.store.get("receipt", r.id)?.state !== "received"
    )
      return;
    const binding = this.store.get("binding", r.key);
    if (binding && !this.routeFor(binding))
      return this.finish(
        r,
        "rejected",
        "This conversation belongs to an earlier mapping. Start a new Slack thread.",
      );
    const text = r.text.trim();
    if (text === "status" && !featureEnabled(this.config, "status"))
      return this.finish(r, "rejected", accessMessage);
    if (text === "status" || text === "help") {
      this.enqueue(
        r.key,
        r.channel,
        r.root,
        text === "help"
          ? "Mention me with a task to start. In its Slack thread, mention me with a follow-up, “status”, “stop”, “mute”, or “unmute”. Mute only silences updates; the agent keeps working. Machine and Project are configured in Zana."
          : binding
            ? `Zana: ${binding.state}${binding.paused ? " · updates muted (agent continues)" : ""}. Open Zana for Slack in Zana for details.`
            : "No Zana agent is linked to this Slack thread.",
        `reply:${r.id}`,
        true,
      );
      if (text === "help") {
        const reply = this.store.get("delivery", `reply:${r.id}`)!;
        this.store.put("delivery", reply.id, { ...reply, control: true });
      }
      this.store.put("receipt", r.id, {
        ...r,
        state: "settled",
        note: "Status reply queued.",
      });
      return;
    }
    if (binding && ["archived", "deleted"].includes(binding.state))
      return this.finish(
        r,
        "rejected",
        "This Zana conversation is no longer available. Start a new top-level Slack mention for another agent.",
      );
    if (["stop", "mute", "unmute", "pause", "resume"].includes(text)) {
      if (!binding)
        return this.finish(
          r,
          "rejected",
          "No agent is linked to this conversation. Mention me with a task to start one.",
        );
      if (text === "stop") {
        await this.stop(binding.key);
      } else {
        this.mute(binding.key, text === "mute" || text === "pause");
      }
      return this.finish(
        r,
        "settled",
        text === "stop"
          ? "Agent stopped. Queued follow-ups were cancelled."
          : ["mute", "pause"].includes(text)
            ? "Updates muted. The agent continues working. Mention me with “unmute” to restore updates."
            : "Updates unmuted. New agent updates will appear here.",
      );
    }
    if (!featureEnabled(this.config, binding ? "followups" : "launch"))
      return this.finish(r, "rejected", accessMessage);
    const command =
      text === "run"
        ? ""
        : text.startsWith("run ")
          ? text.slice(4).trim()
          : text;
    if (!command)
      return this.finish(
        r,
        "rejected",
        "A task is required. Mention me with what you want the agent to do.",
      );
    if (
      this.store
        .list("receipt", ["queued", "dispatching", "needs-review"])
        .filter((q) => q.key === r.key).length >= 10
    )
      return this.finish(
        r,
        "rejected",
        "This conversation queue is full. Wait for a turn to finish before sending another task.",
      );
    this.store.put("receipt", r.id, {
      ...r,
      command,
      route: {
        projectId: route.projectId,
        hostId: route.hostId,
        providerId: route.providerId,
        model: route.model,
      },
      state: "queued",
      note: "Waiting for an execution slot.",
    });
    this.status(r, "Request received · Waiting for an execution slot.");
    this.changed();
    await this.zcc.sdk.inbox
      .push({
        projectId: route.projectId,
        comments:
          "Slack request received. Open its conversation from Zana for Slack to track the agent and delivery status.",
      })
      .catch(() => {});
  }
  mute(key: string, muted: boolean): void {
    const b = this.store.get("binding", key);
    if (!b || !this.routeFor(b) || ["deleted", "archived"].includes(b.state))
      throw new Error(
        "Conversation is no longer available. Start a new Slack conversation.",
      );
    b.paused = muted;
    this.embeds.revoke();
    this.store.put("binding", key, b);
    const requestId = b.active || b.lastRequest;
    const d = requestId
      ? this.store.get("delivery", `status:${requestId}`)
      : undefined;
    if (
      d?.ts &&
      !d.remove &&
      !["uncertain", "reviewed", "removed"].includes(d.state)
    )
      this.store.put("delivery", d.id, {
        ...d,
        control: true,
        text: muted
          ? statusText(
              "muted",
              "Updates muted. The agent continues working. Mention me with “unmute” to restore updates.",
            )
          : b.active
            ? statusText(
                activeStatusKind(b),
                `${activeStatusText(b)} Updates unmuted.`,
              )
            : statusText(
                "completed",
                "Updates unmuted. Mention me with a follow-up.",
              ),
        state: d.state === "sending" ? "sending" : "queued",
        revision: (d.revision || 1) + 1,
        next: Date.now(),
        modified: Date.now(),
      });
    this.changed();
  }
  async stop(key: string): Promise<void> {
    const b = this.store.get("binding", key);
    if (!b || !this.routeFor(b) || ["deleted", "archived"].includes(b.state))
      throw new Error(
        "Conversation is no longer available. Start a new Slack conversation.",
      );
    const active = b.active;
    if (active) {
      const r = this.store.get("receipt", active);
      if (r)
        this.status(
          r,
          "Stop requested · Waiting for Zana to confirm.",
          "stopping",
        );
    }
    b.stopping = true;
    b.state = "stopping";
    this.store.put("binding", key, b);
    for (const r of this.store.list("receipt", ["received", "queued"]))
      if (r.key === key) this.finish(r, "cancelled", "Cancelled by stop.");
    try {
      await this.zcc.sdk.threads.stop({ threadId: b.threadId });
      b.state = "stopped";
      b.needsAttention = false;
      b.pendingInteractions = [];
      b.active = undefined;
      b.activity = "working";
      b.activityItemId = undefined;
      this.store.put("binding", key, b);
      if (active) {
        const r = this.store.get("receipt", active);
        if (r)
          this.finish(
            r,
            "settled",
            "Agent stopped. Queued follow-ups were cancelled.",
          );
      }
    } catch {
      b.state = "needs-review";
      this.store.put("binding", key, b);
      throw new Error("Stop could not be confirmed. Open the thread in Zana.");
    }
    this.changed();
  }
  async publish(
    threadId: string,
    projectId: string,
    text: string,
    manual = false,
    resultValue?: unknown,
  ): Promise<{ state: string }> {
    const b = this.store
      .list("binding")
      .find((b) => b.threadId === threadId && b.projectId === projectId);
    if (!b || b.paused || !this.config.enabled)
      throw new Error(
        "This thread is not connected to an enabled Slack destination.",
      );
    const route = this.routeFor(b);
    if (
      !featureEnabled(this.config, "answers") ||
      !route ||
      (!manual && !route.summaries)
    )
      throw new Error("Agent summaries are not enabled for this channel.");
    const content = string(text, 2000);
    if (resultValue !== undefined && this.config.richResultsEnabled !== true)
      throw new Error(
        "Rich results are disabled. Enable Share rich results in Zana for Slack first.",
      );
    const result =
      resultValue === undefined ? undefined : parseRichResult(resultValue);
    const requestId = b.active || b.lastRequest;
    if (!manual && requestId)
      this.upsertMessage(
        `answer:${requestId}`,
        b.key,
        b.channel,
        b.root,
        content,
        "agent",
        requestId,
        false,
        result,
      );
    else {
      const id = randomUUID();
      this.enqueue(
        b.key,
        b.channel,
        b.root,
        content,
        id,
        false,
        manual ? "operator" : "agent",
      );
      if (result)
        this.store.put("delivery", id, {
          ...this.store.get("delivery", id)!,
          result,
        });
    }
    if (!manual && requestId)
      this.refreshFormattingStatus(
        this.store.get("delivery", `answer:${requestId}`),
      );
    return { state: "queued" };
  }
  resolve(id: string): void {
    const r = this.store.get("receipt", id);
    if (!r || r.state !== "needs-review")
      throw new Error("No request to review.");
    this.finish(r, "cancelled", "Reviewed locally. No automatic retry.");
    const b = this.store.get("binding", r.key);
    if (b?.state === "needs-review") {
      b.state = "unknown";
      b.active = undefined;
      this.store.put("binding", b.key, b);
    }
  }
  resolveDelivery(id: string): void {
    const d = this.store.get("delivery", id);
    if (!d || d.state !== "uncertain")
      throw new Error("No uncertain delivery to review.");
    this.store.put("delivery", id, {
      ...d,
      state: "reviewed",
      note: "Reviewed in Slack. No retry was sent.",
    });
    this.changed();
  }
  async event(e: Pick<ThreadEvent, "name" | "threadId">): Promise<void> {
    if (this.disposed) return;
    let b = this.store.list("binding").find((b) => b.threadId === e.threadId);
    if (!b || !ownsBinding(this.config, b)) return;
    if (e.name === "thread.active") {
      // An automatic continuation can resume a turn after an idle signal. Keep
      // its original receipt/status rather than leaving a false completion behind.
      if (!b.active && b.lastRequest) {
        const r = this.unansweredContinuation(b);
        if (!r) return;
        const generation = this.generation;
        const thread = await this.zcc.sdk.threads
          .get({ threadId: b.threadId })
          .catch(() => undefined);
        const current = this.store.get("binding", b.key);
        const continuing = current
          ? this.unansweredContinuation(current)
          : undefined;
        if (
          generation !== this.generation ||
          this.disposed ||
          !this.config.enabled ||
          !current ||
          !ownsBinding(this.config, current) ||
          !this.routeFor(current) ||
          current.active ||
          current.lastRequest !== r.id ||
          continuing?.id !== r.id ||
          current.stopping ||
          !thread ||
          !["active", "running", "starting"].includes(thread.status)
        )
          return;
        b = current;
        b.active = r.id;
        this.store.put("receipt", r.id, {
          ...continuing!,
          state: "running",
          outcome: undefined,
          note: "Working…",
        });
      }
      b.state = "running";
      b.activity = "working";
      b.activityItemId = undefined;
      b.updated = Date.now();
      this.store.put("binding", b.key, b);
      const r = b.active ? this.store.get("receipt", b.active) : undefined;
      if (r?.state === "running") this.status(r, activeStatusText(b));
      this.changed();
      return;
    }
    if (e.name === "thread.idle" && b.active && !b.stopping) {
      // Lifecycle callbacks can arrive late. A currently active or unavailable
      // host is not evidence that the task finished; the poll will reconcile it.
      const generation = this.generation,
        active = b.active;
      const thread = await this.zcc.sdk.threads
        .get({ threadId: b.threadId })
        .catch(() => undefined);
      const current = this.store.get("binding", b.key);
      if (
        generation !== this.generation ||
        this.disposed ||
        !this.config.enabled ||
        !current ||
        !ownsBinding(this.config, current) ||
        !this.routeFor(current) ||
        current.active !== active ||
        !thread ||
        !["idle", "stopped"].includes(thread.status)
      )
        return;
      b = current;
    }
    const label: Record<string, string> = {
      "thread.idle": "Ready for a follow-up.",
      "thread.failed": "The agent encountered an error. Open Zana for details.",
      "thread.archived": "The Zana thread was archived.",
      "thread.deleted": "The Zana thread was deleted.",
    };
    if (!label[e.name]) return;
    const state = e.name.slice(7);
    if (["archived", "deleted"].includes(state)) this.embeds.revoke();
    if (b.state === state && !b.active) return;
    const active = b.active;
    b.state = b.stopping && state === "idle" ? "stopped" : state;
    b.needsAttention = false;
    b.activity = "working";
    b.activityItemId = undefined;
    b.pendingInteractions = [];
    b.active = undefined;
    b.updated = Date.now();
    this.store.transaction(() => {
      this.store.put("binding", b.key, b);
      if (active) {
        const r = this.store.get("receipt", active);
        if (r && r.state !== "needs-review")
          this.finish(
            r,
            "settled",
            b.stopping
              ? "Agent stopped. Queued follow-ups were cancelled."
              : e.name === "thread.idle"
                ? this.endedText(r)
                : label[e.name],
          );
      }
    });
    // Archiving/deleting an ended thread only changes local history, not Slack.
    this.changed();
  }
  private async resolveSlackLink(b: Binding): Promise<void> {
    if (
      b.slackUrl ||
      !this.slack ||
      b.team !== this.config.identity?.team ||
      b.app !== this.config.identity?.app ||
      !this.routeFor(b)
    )
      return;
    const result = await this.slack
      .call("chat.getPermalink", { channel: b.channel, message_ts: b.root })
      .catch(() => ({}));
    const permalink = object(result).permalink;
    if (typeof permalink !== "string") return;
    try {
      const url = new URL(permalink);
      if (
        url.protocol !== "https:" ||
        !url.hostname.endsWith(".slack.com") ||
        url.username ||
        url.password ||
        url.pathname !== `/archives/${b.channel}/p${b.root.replace(".", "")}`
      )
        return;
      const current = this.store.get("binding", b.key);
      if (current)
        this.store.put("binding", b.key, { ...current, slackUrl: url.href });
      this.changed();
    } catch {
      /* A malformed permalink does not affect agent execution. */
    }
  }
  private async dispatch(r: Receipt): Promise<void> {
    let b = this.store.get("binding", r.key);
    if (!featureEnabled(this.config, b ? "followups" : "launch"))
      return this.finish(r, "rejected", accessMessage);
    const route = this.destinationRoute(r.channel, r.root);
    if (
      r.team !== this.config.identity?.team ||
      r.app !== this.config.identity?.app ||
      !route ||
      r.user !== this.config.owner ||
      !r.route ||
      r.route.projectId !== route.projectId ||
      r.route.hostId !== route.hostId ||
      r.route.providerId !== route.providerId ||
      r.route.model !== route.model ||
      (r.requestedRoute && !sameRoute(r.requestedRoute, route)) ||
      (b && !this.routeFor(b))
    )
      return this.finish(
        r,
        "rejected",
        "Mapping or owner changed. Check the channel settings in Zana, then start a new Slack conversation.",
      );
    if (Date.now() - r.created > 30 * 60000)
      return this.finish(
        r,
        "rejected",
        "Request expired in queue. Send a new request when the agent is available.",
      );
    if (b && (b.active || b.state === "needs-review" || b.state === "stopping"))
      return;
    if (b && ["archived", "deleted"].includes(b.state))
      return this.finish(
        r,
        "rejected",
        "Start a new Slack thread for another agent.",
      );
    if (
      this.store.list("receipt", ["needs-review"]).some((q) => q.key === r.key)
    )
      return;
    const running = this.store
      .list("binding")
      .filter(
        (x) =>
          ownsBinding(this.config, x) &&
          (x.active ||
            ["running", "stopping", "needs-review"].includes(x.state)),
      );
    const uncertain = this.store
      .list("receipt", ["dispatching", "needs-review"])
      .filter((q) => {
        const binding = this.store.get("binding", q.key);
        return (
          q.user === this.config.owner &&
          (!binding || ownsBinding(this.config, binding)) &&
          !running.some((b) => b.key === q.key)
        );
      });
    if (
      running.length + uncertain.length >= 2 ||
      uncertain.some((q) => q.route?.projectId === route.projectId) ||
      running.some((x) => x.projectId === route.projectId && x.key !== r.key)
    )
      return;
    if (!b && !route.model)
      return this.finish(
        r,
        "rejected",
        "Choose a model and save the channel mapping in Zana before starting a new conversation.",
      );
    const generation = this.generation;
    const ownerEpoch = this.config.ownerEpoch;
    if (!b && r.requestedRoute) {
      try {
        if (
          !(
            await this.models({
              hostId: route.hostId,
              providerId: route.providerId,
            })
          ).some((m) => m.id === route.model)
        )
          return this.finish(
            r,
            "rejected",
            "This model is no longer available for the selected harness. Open a new launch form.",
          );
      } catch {
        return this.finish(
          r,
          "rejected",
          "The harness or model could not be verified. Check its configuration in Zana, then open a new launch form.",
        );
      }
    }
    if (b) {
      const thread = await this.zcc.sdk.threads.get({ threadId: b.threadId });
      if (!thread || thread.status === "archived")
        return this.finish(
          r,
          "rejected",
          "This Zana conversation is no longer available. Start a new top-level Slack mention.",
        );
      if (!["idle", "failed", "error", "stopped"].includes(thread.status))
        return;
    }
    const [projects, hosts, providers] = await Promise.all([
      this.zcc.sdk.projects.list(),
      machines(this.zcc),
      this.zcc.sdk.providers.list(),
    ]);
    const permissionMode = launchPermission(
      providers.find((p) => p.id === route.providerId),
    );
    if (!b && !permissionMode)
      return this.finish(
        r,
        "rejected",
        "This harness has no supported execution permission mode. Check its configuration in Zana.",
      );
    const machine = hosts.find((h) => h.id === route.hostId);
    if (!machine || machine.status === "disconnected")
      return this.finish(
        r,
        "rejected",
        "The execution machine is offline. Reconnect it in Zana, then send a new request.",
      );
    if (
      !projects.some((p) => p.id === route.projectId) ||
      !(await this.authorize(r.channel, r.root))
    )
      return this.finish(
        r,
        "rejected",
        "Project or Slack channel is no longer available.",
      );
    if (generation !== this.generation || !this.config.enabled) return;
    if (
      !this.destinationRoute(r.channel, r.root) ||
      !sameRoute(this.destinationRoute(r.channel, r.root)!, route) ||
      this.store.get("receipt", r.id)?.state !== "queued"
    )
      return;
    if (!featureEnabled(this.config, b ? "followups" : "launch"))
      return this.finish(r, "rejected", accessMessage);
    this.finish(r, "dispatching", "Dispatch in progress; replay is disabled.");
    try {
      if (!b) {
        if (this.store.list("binding", undefined, 1001).length >= 1000) {
          this.finish(
            r,
            "rejected",
            "Conversation limit reached. Open Zana for Slack in Zana to review its retained history before starting more work.",
          );
          return;
        }
        const launch = {
          projectId: route.projectId,
          hostId: route.hostId,
          providerId: route.providerId,
          model: route.model,
          prompt: r.command!,
          title: `Slack · ${r.command!.slice(0, 100)}`,
          visibility: "visible",
          permissionMode,
          pluginMetadata: {
            slackConversation: r.key,
            slackRequest: r.id,
            interactionSurface: slackInteractionSurface,
          },
        } as const;
        const result = await this.zcc.sdk.threads.spawn(launch);
        b = {
          user: r.user,
          ownerEpoch,
          launch: this.home.conversation(r.channel, r.root),
          key: r.key,
          sourceChannel: route.sourceChannel,
          channel: r.channel,
          root: r.root,
          team: r.team,
          app: r.app,
          projectId: route.projectId,
          hostId: route.hostId,
          providerId: route.providerId,
          threadId: result.id,
          state: "running",
          activity: "working",
          active: r.id,
          lastRequest: r.id,
          title: r.command!.slice(0, 120),
          updated: Date.now(),
        };
      } else {
        // Upgrade older conversations before another turn can execute desktop tools.
        await persistSlackSurface(this.zcc, b.threadId);
        // Mark active before send: an immediate idle event must still settle this receipt.
        b.active = r.id;
        b.lastRequest = r.id;
        b.needsAttention = false;
        b.pendingInteractions = [];
        b.stopping = false;
        b.state = "running";
        b.activity = "working";
        b.activityItemId = undefined;
        this.store.put("binding", b.key, b);
        await this.zcc.sdk.threads.send({
          threadId: b.threadId,
          prompt: r.command!,
          mode: "start",
        });
        b = this.store.get("binding", b.key)!;
      }
      this.store.put("binding", b.key, b);
      this.finish(
        r,
        b.active ? "running" : "settled",
        b.active
          ? "Working…"
          : this.store.get("receipt", r.id)?.note || this.endedText(r),
      );
      if (generation !== this.generation || this.disposed) {
        this.finish(
          r,
          "needs-review",
          "Connection changed during dispatch. Inspect the Zana thread.",
        );
        return;
      }
      await this.resolveSlackLink(b);
      // Covers a completion event arriving before the spawn result and binding.
      const thread = await this.zcc.sdk.threads.get({ threadId: b.threadId });
      if (
        thread &&
        ["idle", "failed", "error", "archived"].includes(thread.status)
      )
        await this.event({
          name: `thread.${thread.status === "error" ? "failed" : thread.status}` as ThreadEvent["name"],
          threadId: b.threadId,
        });
    } catch {
      this.finish(
        r,
        "needs-review",
        "Dispatch result is uncertain. Inspect Zana before sending another task.",
      );
      if (b) {
        b.state = "needs-review";
        this.store.put("binding", b.key, b);
      }
    }
  }
  async tick(): Promise<void> {
    if (this.disposed || !this.slack || !this.config.enabled) return;
    if (!this.sending) void this.flush().catch(() => {});
    if (this.busy) return;
    this.busy = true;
    try {
      await this.chat.tick();
      await this.forms.tick();
      await this.home.tick();
      for (const r of this.store.list("receipt", ["received"], 20)) {
        if (!this.config.enabled || this.disposed) break;
        try {
          await this.admit(r);
        } catch {
          this.finish(
            r,
            "rejected",
            "Validation failed. Check connection and try a new request.",
          );
        }
      }
      for (const r of this.store.list("receipt", ["queued"], 100)) {
        if (!this.config.enabled || this.disposed) break;
        await this.dispatch(r);
      }
      if (Date.now() - this.lastReconcile > 10000) {
        this.lastReconcile = Date.now();
        this.store.prune();
        const missingLink = this.store
          .list("binding")
          .find(
            (b) =>
              !b.slackUrl &&
              b.team === this.config.identity?.team &&
              b.app === this.config.identity?.app &&
              !["deleted", "archived"].includes(b.state) &&
              this.routeFor(b),
          );
        if (missingLink) await this.resolveSlackLink(missingLink);
        const bindings = this.store
          .list("binding")
          .filter((b) => ownsBinding(this.config, b) && this.routeFor(b));
        const activeBindings = bindings.filter((b) => b.active).slice(0, 2);
        // Probe one unanswered idle task per poll, rotating through retained
        // conversations. This repairs a missed active event across plugin reload
        // without letting ended history starve the two current work slots.
        const ended = bindings.filter(
          (b) =>
            !b.active &&
            b.state === "idle" &&
            !b.stopping &&
            this.unansweredContinuation(b),
        );
        const probe = ended.length
          ? ended[this.continuationCursor++ % ended.length]
          : undefined;
        for (const original of [...activeBindings, ...(probe ? [probe] : [])]) {
          const generation = this.generation;
          const t = await this.zcc.sdk.threads
            .get({ threadId: original.threadId })
            .catch(() => undefined);
          if (t === undefined) continue;
          if (!original.active) {
            if (t && ["active", "running", "starting"].includes(t.status))
              await this.event({
                name: "thread.active",
                threadId: original.threadId,
              });
            continue;
          }
          const events = t
            ? await this.zcc.sdk.threads.events
                .list({ threadId: original.threadId, limit: 500, order: "asc" })
                .catch(() => undefined)
            : undefined;
          // SDK calls can overlap completion, stop, owner rotation or a new turn.
          // Re-read before writing so an old activity sample cannot revive work.
          const b = this.store.get("binding", original.key);
          if (
            generation !== this.generation ||
            this.disposed ||
            !b ||
            b.active !== original.active ||
            !ownsBinding(this.config, b) ||
            !this.routeFor(b)
          )
            continue;
          const before = activeStatusText(b);
          if (events) {
            applyActivityEvents(b, events);
            if (
              typeof (t as { hasPendingInteraction?: boolean } | null)
                ?.hasPendingInteraction !== "boolean"
            )
              applyAttentionEvents(b, events);
          }
          const attention =
            typeof (t as { hasPendingInteraction?: boolean } | null)
              ?.hasPendingInteraction === "boolean"
              ? !!(t as { hasPendingInteraction?: boolean })
                  .hasPendingInteraction
              : !!b.pendingInteractions?.length;
          b.needsAttention = attention;
          this.store.put("binding", b.key, b);
          if (before !== activeStatusText(b)) {
            const r = b.active && this.store.get("receipt", b.active);
            if (r && r.state === "running") this.status(r, activeStatusText(b));
            this.changed();
          }
          if (t && ["idle", "failed", "error", "archived"].includes(t.status))
            await this.event({
              name: `thread.${t.status === "error" ? "failed" : t.status}` as ThreadEvent["name"],
              threadId: b.threadId,
            });
          else if (t === null)
            await this.event({ name: "thread.deleted", threadId: b.threadId });
        }
      }
      if (
        this.config.projectSync?.enabled &&
        Date.now() - this.lastProjectSync >
          (this.projectSyncStatus.state === "pending" ? 60000 : 5 * 60000) &&
        !this.projectSyncing
      )
        void this.syncProjects().catch(() => {});
    } finally {
      this.busy = false;
    }
  }
  private blocks(d: Delivery): Record<string, unknown>[] {
    return [{ type: "section", text: { type: "plain_text", text: d.text } }];
  }
  /** Remove a redundant preview from one confirmed message, preserving its content. */
  async removeTaskPreview(
    id: string,
  ): Promise<{ state: string; error?: string }> {
    const slack = this.slack,
      generation = this.generation;
    const d = this.store.get("delivery", id);
    const b = d && this.store.get("binding", d.key);
    if (!slack || this.disposed || !this.config.enabled || this.config.embed)
      throw new Error("Connect Slack and turn task previews off first.");
    if (
      !d ||
      d.state !== "sent" ||
      !d.ts ||
      !TIMESTAMP.test(d.ts) ||
      !(d.card || d.result) ||
      !b ||
      !ownsBinding(this.config, b) ||
      b.channel !== d.channel ||
      b.root !== d.root ||
      !this.destinationRoute(d.channel, d.root)
    )
      throw new Error(
        "Choose a confirmed task message in a connected conversation.",
      );
    if (!(await this.authorize(d.channel, d.root)))
      throw new Error("The conversation is no longer an internal channel.");
    if (
      generation !== this.generation ||
      this.disposed ||
      this.config.embed ||
      !ownsBinding(this.config, b) ||
      !this.destinationRoute(d.channel, d.root)
    )
      throw new Error("Slack configuration changed before preview removal.");
    try {
      const result = await slackCall(slack, "chat.update", {
        channel: d.channel,
        ts: d.ts,
        metadata: {},
        attachments: [],
        // Slack rejects metadata-only updates with no_text in this workspace.
        // Reuse the confirmed content so clearing a preview never erases blocks.
        text: plainSlack(d.text),
        blocks: d.result ? richResultBlocks(d.result, d.text) : this.blocks(d),
        mrkdwn: false,
        parse: "none",
        unfurl_links: false,
        unfurl_media: false,
      });
      return {
        state:
          result.ok === false
            ? "failed"
            : result.ok === true &&
                result.channel === d.channel &&
                result.ts === d.ts
              ? "removed"
              : "uncertain",
        ...(result.ok === false &&
        typeof result.error === "string" &&
        /^[a-z_]{1,80}$/.test(result.error)
          ? { error: result.error }
          : {}),
      };
    } catch {
      // Removal never sends a replacement message or retries an ambiguous write.
      return { state: "uncertain" };
    }
  }
  private removableStatus(d?: Delivery): d is Delivery {
    if (
      !d ||
      d.origin !== "status" ||
      !d.requestId ||
      d.id !== `status:${d.requestId}` ||
      d.result ||
      d.questionId ||
      d.canvasId ||
      d.homeLaunchId
    )
      return false;
    const r = this.store.get("receipt", d.requestId),
      b = this.store.get("binding", d.key);
    return (
      !!r &&
      !!b &&
      r.key === d.key &&
      r.team === this.config.identity?.team &&
      r.app === this.config.identity?.app &&
      r.user === this.config.owner &&
      ownsBinding(this.config, b) &&
      b.channel === d.channel &&
      b.root === d.root &&
      (!d.ts || TIMESTAMP.test(d.ts)) &&
      !!this.deliveryRoute(d)
    );
  }
  private queueStatusRemoval(d?: Delivery): boolean {
    if (
      !this.removableStatus(d) ||
      d.remove ||
      ["removed", "uncertain", "reviewed", "failed"].includes(d.state)
    )
      return false;
    this.store.put("delivery", d.id, {
      ...d,
      remove: true,
      control: true,
      state: d.state === "sending" ? "sending" : d.ts ? "queued" : "removed",
      revision: (d.revision || 1) + 1,
      modified: Date.now(),
      next: Date.now(),
      attempts: 0,
      note:
        d.ts || d.state === "sending"
          ? "Removing temporary status."
          : "Status was never posted.",
    });
    this.changed();
    return true;
  }
  /** Operator-requested cleanup; no caller-supplied Slack timestamp or channel. */
  cleanupStatuses(): { queued: number } {
    if (!this.slack || this.disposed || !this.config.enabled)
      throw new Error("Connect Slack first.");
    let queued = 0;
    for (const d of this.store.list("delivery", ["sent"], 1000)) {
      if (!this.removableStatus(d)) continue;
      const r = this.store.get("receipt", d.requestId!)!,
        b = this.store.get("binding", d.key)!;
      if (
        r.state !== "settled" ||
        b.active === r.id ||
        [
          "stop",
          "mute",
          "unmute",
          "pause",
          "resume",
          "status",
          "help",
        ].includes(r.text)
      )
        continue;
      if (
        (r.outcome && r.outcome !== "completed") ||
        /needs attention|encountered an error|Agent stopped/.test(d.text)
      )
        continue;
      const answer = this.store.get("delivery", `answer:${r.id}`);
      if (answer?.state !== "sent" && !/^(?:✅ )?Turn ended[. ·]/.test(d.text))
        continue;
      if (this.queueStatusRemoval(d)) queued++;
      if (queued >= 100) break;
    }
    return { queued };
  }
  private deliveryRoute(d: Delivery): Route | undefined {
    return d.homeLaunchId
      ? this.home.deliveryRoute(d.homeLaunchId)
      : this.destinationRoute(d.channel, d.root);
  }
  async flush(): Promise<void> {
    if (this.sending || this.disposed || !this.slack || !this.config.enabled)
      return;
    this.sending = true;
    let replyId: string | undefined;
    try {
      const ready = this.store
        .list("delivery", ["queued"])
        .filter(
          (d) =>
            d.next <= Date.now() &&
            (this.channelNext.get(d.channel) || 0) <= Date.now(),
        );
      // The status was updated after enqueueing the answer; publish its footer
      // first so a slow render cannot prevent the progress notice from appearing.
      let d: Delivery | undefined =
        ready.find(
          (d) =>
            d.origin === "status" &&
            !d.remove &&
            d.text.endsWith(FORMATTING_NOTICE),
        ) || ready[0];
      if (!d) return;
      replyId = d.origin === "agent" ? d.id : undefined;
      const destination = d.channel;
      const slack = this.slack,
        generation = this.generation,
        b = this.store.get("binding", d.key);
      if (
        !d.key.startsWith(
          `${this.config.identity?.team}:${this.config.identity?.app}:`,
        ) ||
        Date.now() - (d.modified || d.created) > 30 * 60000 ||
        !this.deliveryRoute(d) ||
        (b &&
          (!ownsBinding(this.config, b) ||
            (!d.control && (!this.routeFor(b) || b.paused))))
      ) {
        this.store.put("delivery", d.id, {
          ...d,
          state: "failed",
          note: "Expired, paused, or destination removed.",
        });
        this.changed();
        return;
      }
      if (
        !(await this.authorize(
          d.channel,
          d.root,
          this.deliveryRoute(d)?.sourceChannel,
        ))
      ) {
        this.store.put("delivery", d.id, {
          ...d,
          state: "failed",
          note: "Destination is no longer an internal channel.",
        });
        this.changed();
        return;
      }
      if (generation !== this.generation || this.disposed) return;
      d = this.store.get("delivery", d.id);
      if (!d || d.state !== "queued") return;
      const current = this.store.get("binding", d.key);
      const currentRoute = this.deliveryRoute(d);
      if (
        !deliveryEnabled(this.config, d) ||
        !currentRoute ||
        (d.requestedRoute && !sameRoute(d.requestedRoute, currentRoute)) ||
        (current &&
          (!ownsBinding(this.config, current) ||
            (!d.control && (!this.routeFor(current) || current.paused)))) ||
        (d.origin === "agent" && !currentRoute.summaries)
      ) {
        this.store.put("delivery", d.id, {
          ...d,
          state: "failed",
          note: "Sharing permission changed before delivery.",
        });
        this.changed();
        return;
      }
      if (d.remove && (!this.removableStatus(d) || !d.ts)) {
        this.store.put("delivery", d.id, {
          ...d,
          state: "failed",
          note: "Status cleanup is no longer authorized.",
        });
        this.changed();
        return;
      }
      if (
        !d.remove &&
        !d.card &&
        !d.questionId &&
        !d.canvasId &&
        ["agent", "operator"].includes(d.origin || "") &&
        diagramSources(d).length
      ) {
        const original = d;
        const allowed = () => {
          const latest = this.store.get("delivery", original.id),
            binding = this.store.get("binding", original.key);
          return (
            generation === this.generation &&
            !this.disposed &&
            slack === this.slack &&
            !!latest &&
            latest.state === "queued" &&
            latest.revision === original.revision &&
            deliveryEnabled(this.config, latest) &&
            !!this.deliveryRoute(latest) &&
            sameRoute(this.deliveryRoute(latest)!, currentRoute) &&
            !!binding &&
            ownsBinding(this.config, binding) &&
            !binding.paused &&
            !!this.routeFor(binding) &&
            (latest.origin !== "agent" || currentRoute.summaries)
          );
        };
        await prepareDiagrams(
          this.store,
          d,
          slack,
          allowed,
          AbortSignal.any([
            this.diagramAbort.signal,
            AbortSignal.timeout(30_000),
          ]),
          this.diagramRenderer,
        );
        if (!allowed()) return;
        d = this.store.get("delivery", d.id)!;
        // Rendering may take several seconds; verify live channel membership again.
        if (
          !(await this.authorize(
            d.channel,
            d.root,
            currentRoute.sourceChannel,
          )) ||
          !allowed()
        )
          return;
      }
      const sourceHashes = new Set(diagramSources(d).map(diagramHash));
      const images = diagramImages(
        (d.diagrams || []).filter((image) => sourceHashes.has(image.hash)),
      );
      this.store.put("delivery", d.id, {
        ...d,
        state: "sending",
        attempts: d.attempts + 1,
      });
      this.channelNext.set(d.channel, Date.now() + 1200);
      try {
        const method = d.remove
          ? "chat.delete"
          : d.ts
            ? "chat.update"
            : "chat.postMessage";
        const args = {
          channel: d.channel,
          ...(images.size ? { conversation_ts: d.root } : {}),
          ...(d.ts ? { ts: d.ts } : d.root ? { thread_ts: d.root } : {}),
          ...(d.result
            ? {
                blocks: [
                  ...richResultBlocks(d.result, d.text, images),
                  ...this.forms.resultActions(d),
                ],
              }
            : d.card
              ? { blocks: this.blocks(d) }
              : ["agent", "operator"].includes(d.origin || "") &&
                  !d.questionId &&
                  !d.canvasId
                ? {
                    blocks: [
                      ...slackMarkdownBlocks(d.text, images),
                      ...this.forms.resultActions(d),
                    ],
                  }
                : {}),
          text: plainSlack(d.text),
          ...(!d.result &&
          !d.card &&
          (this.forms.deliveryBlocks(d) || this.forms.resultActions(d).length)
            ? {
                blocks: this.forms.deliveryBlocks(d) || [
                  ...slackMarkdownBlocks(d.text, images),
                  ...this.forms.resultActions(d),
                ],
              }
            : {}),
          mrkdwn: false,
          parse: "none",
          unfurl_links: false,
          unfurl_media: false,
        };
        let metadata =
          d.card || d.result ? this.embeds.metadata(d.key) : undefined;
        const removingPreview =
          !this.config.embed && !!d.ts && !!(d.card || d.result);
        if (removingPreview) metadata = {};
        const clearAttachments = removingPreview ? { attachments: [] } : {};
        let rich = !!args.blocks?.some(
          (block: Record<string, unknown>) =>
            block.type === "rich_text" ||
            block.type === "table" ||
            block.type === "data_visualization",
        );
        let presentation: Delivery["presentation"] = rich ? "rich" : "text";
        // Definitive API rejection means no message was accepted. Ambiguous errors
        // always escape to the existing uncertain-delivery path without a retry.
        const attempt = async () => {
          try {
            return await slack.call(
              method,
              d.remove
                ? { channel: d.channel, ts: d.ts }
                : {
                    ...args,
                    ...clearAttachments,
                    ...(metadata ? { metadata } : {}),
                  },
            );
          } catch (error) {
            const e = object(error);
            if (
              e.code !== "slack_webapi_platform_error" ||
              !(
                (metadata &&
                  ["invalid_metadata", "feature_not_enabled"].includes(
                    e.data?.error,
                  )) ||
                ((rich || presentation === "compatible") &&
                  ["invalid_blocks", "feature_not_enabled"].includes(
                    e.data?.error,
                  ))
              )
            )
              throw error;
            return { ok: false, error: e.data.error };
          }
        };
        let result = await attempt();
        for (
          let fallback = 0;
          fallback < 3 && result.ok === false;
          fallback++
        ) {
          if (
            metadata &&
            ["invalid_metadata", "feature_not_enabled"].includes(result.error)
          ) {
            if (!removingPreview) this.embeds.rejectedMetadata();
            metadata = undefined;
          } else if (
            (rich || presentation === "compatible") &&
            ["invalid_blocks", "feature_not_enabled"].includes(result.error)
          ) {
            // A completed upload can briefly be unavailable to Slack's block
            // validator. A definitive rejection accepted no message: defer in
            // the durable outbox and reuse the upload, with a bounded retry cap.
            if (
              rich &&
              images.size &&
              result.error === "invalid_blocks" &&
              (d.imageRetries || 0) < 3
            ) {
              const latest = this.store.get("delivery", d.id)!;
              if (generation !== this.generation || this.disposed) return;
              this.store.put("delivery", d.id, {
                ...latest,
                state: "queued",
                imageRetries:
                  latest.revision === d.revision
                    ? (d.imageRetries || 0) + 1
                    : latest.imageRetries,
                next:
                  Date.now() +
                  (latest.revision === d.revision
                    ? [1000, 3000, 8000][d.imageRetries || 0]
                    : 0),
                note: "Slack rejected the image blocks; waiting briefly before trying the same answer again.",
              });
              this.changed();
              return;
            }
            rich = false;
            if (presentation === "rich") {
              args.blocks = compatibleSlackBlocks(args.blocks!);
              presentation = "compatible";
            } else {
              args.blocks = d.card ? this.blocks(d) : undefined;
              args.text = plainSlack(
                slackReadableText(d.text) +
                  [...images.values()]
                    .filter((image) => image.permalink)
                    .map((image) => `\n\nDiagram: ${image.permalink}`)
                    .join(""),
              );
              presentation = "text";
            }
          } else break;
          if (generation !== this.generation || this.disposed) return;
          const fallbackBinding = this.store.get("binding", d.key);
          if (
            !deliveryEnabled(this.config, d) ||
            !this.deliveryRoute(d) ||
            !sameRoute(this.deliveryRoute(d)!, currentRoute) ||
            (fallbackBinding &&
              !d.control &&
              (fallbackBinding.paused || !this.routeFor(fallbackBinding)))
          ) {
            this.store.put("delivery", d.id, {
              ...this.store.get("delivery", d.id)!,
              state: "failed",
              note: "Sharing permission changed before fallback delivery.",
            });
            this.changed();
            return;
          }
          result = await attempt();
        }
        if (
          d.remove &&
          result.ok === false &&
          result.error === "message_not_found"
        )
          result = { ok: true, channel: d.channel, ts: d.ts };
        if (
          result.ok === true &&
          result.channel === d.channel &&
          typeof result.ts === "string" &&
          TIMESTAMP.test(result.ts) &&
          (!d.ts || d.ts === result.ts)
        )
          this.store.put("delivery", d.id, {
            ...this.store.get("delivery", d.id)!,
            state: d.remove
              ? "removed"
              : this.store.get("delivery", d.id)?.revision !== d.revision
                ? "queued"
                : "sent",
            attempts: d.attempts + 1,
            ts: result.ts,
            note: d.remove
              ? "Slack confirmed status removal."
              : "Slack confirmed receipt.",
            presentation,
          });
        else
          this.store.put("delivery", d.id, {
            ...this.store.get("delivery", d.id)!,
            state: result.ok === false ? "failed" : "uncertain",
            attempts: d.attempts + 1,
            note:
              result.ok === false
                ? "Slack rejected the message."
                : "Slack returned an incomplete confirmation. Check Slack before sending again.",
          });
      } catch (error) {
        const e = object(error),
          retry = Number(e.retryAfter);
        if (
          e.code === "slack_webapi_rate_limited_error" &&
          Number.isFinite(retry) &&
          retry > 0 &&
          d.attempts < 4
        ) {
          const next = Date.now() + retry * 1000;
          this.channelNext.set(d.channel, next);
          this.store.put("delivery", d.id, {
            ...this.store.get("delivery", d.id)!,
            state: "queued",
            next,
            attempts: d.attempts + 1,
            note: "Waiting for Slack rate limit.",
          });
        } else
          this.store.put("delivery", d.id, {
            ...this.store.get("delivery", d.id)!,
            state:
              e.code === "slack_webapi_platform_error" ? "failed" : "uncertain",
            attempts: d.attempts + 1,
            note:
              e.code === "slack_webapi_platform_error"
                ? "Slack rejected the message."
                : "Delivery could not be confirmed. Check Slack; this will not be retried automatically.",
          });
      }
      const replyRequestId =
        d.origin === "agent"
          ? d.requestId
          : d.questionId
            ? this.store.get("question", d.questionId)?.requestId
            : undefined;
      if (replyRequestId) {
        const r = this.store.get("receipt", replyRequestId);
        if (r && this.completedReceipt(r)) {
          if (this.store.get("delivery", d.id)?.state === "sent")
            this.queueStatusRemoval(
              this.store.get("delivery", `status:${r.id}`),
            );
          this.finish(r, "settled", this.endedText(r));
        }
      }
      this.changed();
    } finally {
      if (replyId)
        this.refreshFormattingStatus(this.store.get("delivery", replyId));
      this.sending = false;
    }
  }
}
