import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  GatewayIntentBits,
  SlashCommandBuilder,
} from "discord.js";
import { config } from "./config.js";
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

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

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

const restoredEntries = await syncQueue.restore();
if (restoredEntries > 0) {
  console.log(`Restored ${restoredEntries} pending Discord role synchronizations`);
}
syncQueue.start();

client.once(Events.ClientReady, async (readyClient) => {
  const guild = await readyClient.guilds.fetch(config.DISCORD_GUILD_ID);
  await guild.commands.set(commands);
  console.log(`LH-Discord ready as ${readyClient.user.tag}`);
  process.send?.("ready");
});

client.on(Events.GuildMemberUpdate, async (_previous, member) => {
  if (member.guild.id !== config.DISCORD_GUILD_ID) return;
  try {
    const outcome = await syncQueue.synchronize(roleSyncForMember(member));
    if (outcome !== "synchronized") {
      console.warn(`Discord role synchronization ${outcome} for ${member.id}`);
    }
  } catch (error) {
    console.error("Discord role synchronization queue failed", error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || !interaction.inGuild()) return;

  if (interaction.commandName === "lh-sync") {
    const member = await interaction.guild?.members.fetch(interaction.user.id);
    if (!member) {
      await interaction.reply({ content: "Guild membership was not found.", ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    try {
      const outcome = await syncQueue.synchronize(roleSyncForMember(member));
      if (outcome === "synchronized") {
        await interaction.editReply("Your Legacy Hosting staff roles are synchronized.");
      } else if (outcome === "queued") {
        await interaction.editReply("Role synchronization is queued and will retry automatically.");
      } else {
        await interaction.editReply("Role synchronization needs administrator attention.");
      }
    } catch {
      await interaction.editReply("Role synchronization is temporarily unavailable.");
    }
    return;
  }

  if (interaction.commandName === "lh-health") {
    await interaction.deferReply({ ephemeral: true });
    const healthy = await ssoIsHealthy().catch(() => false);
    await interaction.editReply(
      healthy ? "LH-SSO is operational." : "LH-SSO is currently unavailable.",
    );
    return;
  }

  if (interaction.commandName === "lh-link") {
    const member = await interaction.guild?.members.fetch(interaction.user.id);
    if (!member) {
      await interaction.reply({ content: "Guild membership was not found.", ephemeral: true });
      return;
    }
    const payload = roleSyncForMember(member);
    if (payload.staffRoles.length === 0) {
      await interaction.reply({
        content: "You need an eligible Legacy Hosting staff role before connecting SSO.",
        ephemeral: true,
      });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    try {
      const outcome = await syncQueue.synchronize(payload);
      if (outcome !== "synchronized") {
        await interaction.editReply(
          outcome === "queued"
            ? "Your roles are queued for synchronization. Run `/lh-link` again shortly."
            : "Role synchronization needs administrator attention before SSO can be connected.",
        );
        return;
      }
      const link = await requestDiscordLink(payload);
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setLabel("Connect SSO account")
          .setStyle(ButtonStyle.Link)
          .setURL(link.linkUrl),
      );
      await interaction.editReply({
        content: "Use your Legacy Hosting passkey to confirm this connection. The private link expires in 10 minutes and works once.",
        components: [row],
      });
    } catch {
      await interaction.editReply(
        "The secure SSO connection link is temporarily unavailable. Please try again.",
      );
    }
  }
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    syncQueue.stop();
    client.destroy();
    process.exit(0);
  });
}

await client.login(config.DISCORD_TOKEN);
