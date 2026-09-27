import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  SlashCommandBuilder,
} from "discord.js";
import { createHash } from "node:crypto";
import { config } from "./config.js";
import { createHubClient, type GitHubPushEvent, type HubDiscordConfiguration } from "./hub.js";
import {
  createNotificationStateStore,
  dueAnnouncements,
  isServiceUnderMaintenance,
  probeService,
} from "./notifications.js";
import {
  roleSyncForMember,
  requestDiscordLink,
  sendDiscordRoleSync,
  ssoIsHealthy,
} from "./sso.js";
import {
  createFileSyncAuditWriter,
  createFileSyncQueueStore,
  createRoleSyncQueue,
} from "./sync-queue.js";

const commands = [
  new SlashCommandBuilder()
    .setName("lh-sync")
    .setDescription("Synchronize your Legacy Hosting staff access"),
  new SlashCommandBuilder()
    .setName("lh-health")
    .setDescription("Check the Legacy Hosting identity service"),
  new SlashCommandBuilder()
    .setName("lh-link")
    .setDescription("Connect your Discord identity to Legacy Hosting SSO"),
].map((command) => command.toJSON());

const syncQueue = createRoleSyncQueue({
  sync: sendDiscordRoleSync,
  store: createFileSyncQueueStore(config.DISCORD_SYNC_QUEUE_FILE),
  audit: createFileSyncAuditWriter(config.DISCORD_SYNC_AUDIT_FILE),
  pollIntervalMs: config.DISCORD_SYNC_POLL_INTERVAL_MS,
  retryBaseMs: config.DISCORD_SYNC_RETRY_BASE_MS,
  retryMaxMs: config.DISCORD_SYNC_RETRY_MAX_MS,
  maxAttempts: config.DISCORD_SYNC_MAX_ATTEMPTS,
  onError: (error) => console.error("Discord role sync queue failed", error),
});
const notificationStore = createNotificationStateStore(config.DISCORD_NOTIFICATION_STATE_FILE);
const hubClient = config.LH_HUB_DISCORD_SERVICE_TOKEN
  ? createHubClient({
      hubUrl: config.LH_HUB_URL,
      token: config.LH_HUB_DISCORD_SERVICE_TOKEN,
      timeoutMs: config.DISCORD_SERVICE_REQUEST_TIMEOUT_MS,
    })
  : undefined;

let client: Client | null = null;
let currentConfiguration: HubDiscordConfiguration | null = null;
let credentialFingerprint = "";
let monitoring = false;

function serviceAppearance(state: "operational" | "degraded" | "outage") {
  if (state === "operational") return { title: "is operational", color: 0x35d89a, asset: "operational" as const };
  if (state === "degraded") return { title: "is degraded", color: 0xf3ae48, asset: "degraded" as const };
  return { title: "is unavailable", color: 0xef6170, asset: "outage" as const };
}

function channelsForEvent(
  configuration: HubDiscordConfiguration,
  event: "operational" | "degraded" | "outage" | "maintenance" | "maintenanceComplete",
  fallback: string[],
) {
  const configured = configuration.events.find((item) => item.key === event)?.channelIds ?? [];
  return configured.length > 0 ? configured : fallback;
}

async function sendToChannels(channelIds: string[], embed: EmbedBuilder) {
  if (!client?.isReady()) return false;
  let delivered = true;
  for (const channelId of new Set(channelIds)) {
    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel?.isSendable()) {
        delivered = false;
        continue;
      }
      await channel.send({ embeds: [embed] });
    } catch (error) {
      delivered = false;
      console.error(`Discord message could not be sent to channel ${channelId}`, error);
    }
  }
  return delivered;
}

function pushEmbed(configuration: HubDiscordConfiguration, event: GitHubPushEvent) {
  const commits = event.commits.filter((commit) => commit.distinct !== false);
  const lines: string[] = [];
  for (const commit of commits) {
    const subject = commit.message.split(/\r?\n/, 1)[0]?.trim() || "Commit without message";
    const author = commit.author?.name || commit.author?.username || "Unknown author";
    const line = "[`" + commit.id.slice(0, 7) + "`](" + commit.url + ") " + subject.slice(0, 180) + " — " + author;
    if (lines.join("\n").length + line.length > 3_200) break;
    lines.push(line);
  }
  if (lines.length < commits.length) lines.push(`…and ${commits.length - lines.length} more commits`);
  const action = event.deleted ? "deleted branch" : event.created ? "created branch" : "pushed";
  return new EmbedBuilder()
    .setColor(0x7561ff)
    .setAuthor({
      name: event.sender.login,
      ...(event.sender.avatar_url ? { iconURL: event.sender.avatar_url } : {}),
      ...(event.sender.html_url ? { url: event.sender.html_url } : {}),
    })
    .setTitle(`${event.repository.fullName} · ${action} ${event.branch}`)
    .setURL(event.compareUrl)
    .setDescription(lines.length > 0 ? lines.join("\n") : "No commit objects were included in this push.")
    .addFields(
      { name: "Branch", value: `\`${event.branch}\``, inline: true },
      { name: "Commit reference", value: `\`${event.after.slice(0, 12)}\``, inline: true },
      { name: "Commits", value: String(commits.length), inline: true },
      { name: "Pushed by", value: event.pusher.name, inline: true },
      { name: "GitHub sender", value: event.sender.login, inline: true },
      { name: "Delivery", value: `\`${event.deliveryId}\``, inline: true },
    )
    .setThumbnail(configuration.assets.logo)
    .setFooter({ text: "Legacy Hosting · GitHub", iconURL: configuration.assets.logo })
    .setTimestamp(new Date(event.headCommit?.timestamp ?? event.receivedAt));
}

function serviceEmbed(
  configuration: HubDiscordConfiguration,
  service: HubDiscordConfiguration["services"][number],
  state: "operational" | "degraded" | "outage",
  latencyMs: number | null,
) {
  const appearance = serviceAppearance(state);
  return new EmbedBuilder()
    .setColor(appearance.color)
    .setTitle(`${service.name} ${appearance.title}`)
    .setDescription([
      `**Server:** ${service.server}`,
      `**Status:** ${state}`,
      `**Response time:** ${latencyMs === null ? "No response" : `${latencyMs} ms`}`,
    ].join("\n"))
    .setThumbnail(configuration.assets[appearance.asset])
    .setFooter({ text: "Legacy Hosting", iconURL: configuration.assets.logo })
    .setTimestamp();
}

function maintenanceEmbed(
  configuration: HubDiscordConfiguration,
  maintenance: HubDiscordConfiguration["maintenance"][number],
  completed: boolean,
) {
  const services = configuration.services.filter((item) => maintenance.targetKeys.includes(item.key));
  return new EmbedBuilder()
    .setColor(completed ? 0x35d89a : 0x7561ff)
    .setTitle(completed ? `${maintenance.title} completed` : maintenance.title)
    .setDescription([
      maintenance.message,
      services.length > 0
        ? `**Services:** ${services.map((service) => `${service.name} (${service.server})`).join(", ")}`
        : "",
      `**Impact:** ${maintenance.impact}`,
      completed
        ? "**Status:** Maintenance complete"
        : `**Window:** <t:${Math.floor(Date.parse(maintenance.scheduledFor) / 1_000)}:F> – <t:${Math.floor(Date.parse(maintenance.scheduledUntil) / 1_000)}:F>`,
    ].filter(Boolean).join("\n\n"))
    .setThumbnail(completed ? configuration.assets.maintenanceComplete : configuration.assets.maintenance)
    .setFooter({ text: "Legacy Hosting", iconURL: configuration.assets.logo })
    .setTimestamp();
}

async function reportPresence(configuration: HubDiscordConfiguration) {
  if (!client?.isReady() || !hubClient) return;
  const guild = await client.guilds.fetch(configuration.guildId);
  const channels = await guild.channels.fetch();
  await hubClient.reportPresence({
    bot: { id: client.user.id, username: client.user.username },
    channels: Array.from(channels.values())
      .filter((channel) => channel?.isTextBased() && !channel.isThread())
      .map((channel) => ({ id: channel!.id, name: channel!.name }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  });
}

async function runNotifications() {
  if (monitoring || !client?.isReady() || !currentConfiguration || !hubClient) return;
  monitoring = true;
  try {
    const configuration = currentConfiguration;
    const state = await notificationStore.load();
    const completedTargets = new Set<string>();

    for (const maintenance of configuration.maintenance) {
      const previous = state.maintenance[maintenance.id];
      const services = configuration.services.filter((item) => maintenance.targetKeys.includes(item.key));
      const serviceChannels = services.flatMap((service) => service.channelIds);
      if (services.length > 0 && !previous && ["scheduled", "in_progress"].includes(maintenance.status)) {
        await sendToChannels(
          channelsForEvent(configuration, "maintenance", serviceChannels),
          maintenanceEmbed(configuration, maintenance, false),
        );
      }
      if (services.length > 0 && maintenance.status === "completed" && previous && previous !== "completed") {
        for (const targetKey of maintenance.targetKeys) completedTargets.add(targetKey);
        await sendToChannels(
          channelsForEvent(configuration, "maintenanceComplete", serviceChannels),
          maintenanceEmbed(configuration, maintenance, true),
        );
      }
      state.maintenance[maintenance.id] = maintenance.status;
    }

    const now = Date.now();
    for (const service of configuration.services) {
      const activeMaintenance = isServiceUnderMaintenance(configuration, service.key, now);
      const probe = await probeService({
        url: service.url,
        timeoutMs: config.DISCORD_SERVICE_REQUEST_TIMEOUT_MS,
        degradedAfterMs: config.DISCORD_SERVICE_DEGRADED_AFTER_MS,
      });
      const nextState = activeMaintenance ? "maintenance" : probe.state;
      const previous = state.services[service.key];
      if (
        previous && previous !== nextState && nextState !== "maintenance" &&
        !(completedTargets.has(service.key) && nextState === "operational")
      ) {
        await sendToChannels(
          channelsForEvent(configuration, nextState, service.channelIds),
          serviceEmbed(configuration, service, nextState, probe.latencyMs),
        );
      }
      state.services[service.key] = nextState;
    }

    for (const announcement of dueAnnouncements(configuration)) {
      const description = announcement.message.replaceAll("{years}", String(announcement.year - 2017));
      const embed = new EmbedBuilder()
        .setColor(0x7561ff)
        .setTitle(announcement.title)
        .setDescription(description)
        .setThumbnail(announcement.imageUrl)
        .setFooter({ text: "Legacy Hosting", iconURL: configuration.assets.logo })
        .setTimestamp();
      await sendToChannels(announcement.channelIds, embed);
      await hubClient.markAnnouncementSent(announcement.key, announcement.year);
    }

    const githubEvents = await hubClient.githubEvents();
    for (const event of githubEvents) {
      const delivered = await sendToChannels(event.channelIds, pushEmbed(configuration, event));
      if (!delivered) break;
      await hubClient.acknowledgeGithubEvents([event.deliveryId]);
    }

    await notificationStore.save(state);
  } catch (error) {
    console.error("LH-Discord notification cycle failed", error);
  } finally {
    monitoring = false;
  }
}

function attachHandlers(nextClient: Client) {
  nextClient.on(Events.GuildMemberUpdate, async (_previous, member) => {
    if (member.guild.id !== currentConfiguration?.guildId) return;
    try {
      const outcome = await syncQueue.synchronize(roleSyncForMember(member));
      if (outcome !== "synchronized") console.warn(`Discord role synchronization ${outcome} for ${member.id}`);
    } catch (error) {
      console.error("Discord role synchronization queue failed", error);
    }
  });

  nextClient.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand() || !interaction.inGuild()) return;
    if (interaction.commandName === "lh-sync") {
      const member = await interaction.guild?.members.fetch(interaction.user.id);
      if (!member) return void await interaction.reply({ content: "Guild membership was not found.", ephemeral: true });
      await interaction.deferReply({ ephemeral: true });
      try {
        const outcome = await syncQueue.synchronize(roleSyncForMember(member));
        await interaction.editReply(outcome === "synchronized"
          ? "Your Legacy Hosting staff roles are synchronized."
          : outcome === "queued"
            ? "Role synchronization is queued and will retry automatically."
            : "Role synchronization needs administrator attention.");
      } catch {
        await interaction.editReply("Role synchronization is temporarily unavailable.");
      }
      return;
    }
    if (interaction.commandName === "lh-health") {
      await interaction.deferReply({ ephemeral: true });
      const healthy = await ssoIsHealthy().catch(() => false);
      await interaction.editReply(healthy ? "LH-SSO is operational." : "LH-SSO is currently unavailable.");
      return;
    }
    if (interaction.commandName === "lh-link") {
      const member = await interaction.guild?.members.fetch(interaction.user.id);
      if (!member) return void await interaction.reply({ content: "Guild membership was not found.", ephemeral: true });
      const payload = roleSyncForMember(member);
      if (payload.staffRoles.length === 0) {
        return void await interaction.reply({
          content: "You need an eligible Legacy Hosting staff role before connecting SSO.",
          ephemeral: true,
        });
      }
      await interaction.deferReply({ ephemeral: true });
      try {
        const outcome = await syncQueue.synchronize(payload);
        if (outcome !== "synchronized") {
          await interaction.editReply(outcome === "queued"
            ? "Your roles are queued for synchronization. Run `/lh-link` again shortly."
            : "Role synchronization needs administrator attention before SSO can be connected.");
          return;
        }
        const link = await requestDiscordLink(payload);
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setLabel("Connect SSO account").setStyle(ButtonStyle.Link).setURL(link.linkUrl),
        );
        await interaction.editReply({
          content: "Use your Legacy Hosting passkey to confirm this connection. The private link expires in 10 minutes and works once.",
          components: [row],
        });
      } catch {
        await interaction.editReply("The secure SSO connection link is temporarily unavailable. Please try again.");
      }
    }
  });
}

async function applyConfiguration(configuration: HubDiscordConfiguration) {
  currentConfiguration = configuration;
  const nextFingerprint = createHash("sha256")
    .update(`${configuration.guildId}\0${configuration.botToken}`)
    .digest("hex");
  if (client?.isReady() && credentialFingerprint === nextFingerprint) {
    await reportPresence(configuration);
    return;
  }
  client?.destroy();
  client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
  attachHandlers(client);
  try {
    await client.login(configuration.botToken);
    credentialFingerprint = nextFingerprint;
    const guild = await client.guilds.fetch(configuration.guildId);
    await guild.commands.set(commands);
    await reportPresence(configuration);
    console.log(`LH-Discord ready as ${client.user?.tag ?? "unknown bot"}`);
    await runNotifications();
  } catch (error) {
    console.error("LH-Discord could not connect with the configured bot", error);
    client.destroy();
    client = null;
    credentialFingerprint = "";
  }
}

async function refreshConfiguration() {
  if (!hubClient) return;
  try {
    const configuration = await hubClient.configuration();
    if (configuration) await applyConfiguration(configuration);
  } catch (error) {
    console.error("LH-Discord could not refresh Hub configuration", error);
  }
}

const restoredEntries = await syncQueue.restore();
if (restoredEntries > 0) console.log(`Restored ${restoredEntries} pending Discord role synchronizations`);
syncQueue.start();
process.send?.("ready");
await refreshConfiguration();

const configurationTimer = setInterval(
  () => void refreshConfiguration(),
  config.DISCORD_CONFIGURATION_POLL_INTERVAL_MS,
);
configurationTimer.unref();
const notificationTimer = setInterval(
  () => void runNotifications(),
  config.DISCORD_SERVICE_POLL_INTERVAL_MS,
);
notificationTimer.unref();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    clearInterval(configurationTimer);
    clearInterval(notificationTimer);
    syncQueue.stop();
    client?.destroy();
    process.exit(0);
  });
}
