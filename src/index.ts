import {
  Client,
  Events,
  GatewayIntentBits,
  SlashCommandBuilder,
} from "discord.js";
import { config } from "./config.js";
import { ssoIsHealthy, syncDiscordMember } from "./sso.js";

const commands = [
  new SlashCommandBuilder()
    .setName("lh-sync")
    .setDescription("Synchronize your Legacy Hosting staff access"),
  new SlashCommandBuilder()
    .setName("lh-health")
    .setDescription("Check the Legacy Hosting identity service"),
].map((command) => command.toJSON());

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

client.once(Events.ClientReady, async (readyClient) => {
  const guild = await readyClient.guilds.fetch(config.DISCORD_GUILD_ID);
  await guild.commands.set(commands);
  console.log(`LH-Discord 1.0.0 ready as ${readyClient.user.tag}`);
});

client.on(Events.GuildMemberUpdate, async (_previous, member) => {
  if (member.guild.id !== config.DISCORD_GUILD_ID) return;
  try {
    await syncDiscordMember(member);
  } catch (error) {
    console.error("Discord role synchronization failed", error);
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
      await syncDiscordMember(member);
      await interaction.editReply("Your Legacy Hosting staff roles are synchronized.");
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
  }
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    client.destroy();
    process.exit(0);
  });
}

await client.login(config.DISCORD_TOKEN);
