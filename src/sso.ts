import type { GuildMember } from "discord.js";
import { config } from "./config.js";
import { configuredStaffRoles, resolveStaffRoles } from "./roles.js";

const roles = configuredStaffRoles(process.env);

export async function syncDiscordMember(member: GuildMember) {
  const response = await fetch(`${config.LH_SSO_URL}/internal/discord/role-sync`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.LH_DISCORD_INTERNAL_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      discordUserId: member.id,
      discordGuildId: member.guild.id,
      staffRoles: resolveStaffRoles(member.roles.cache.keys(), roles),
    }),
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) {
    throw new Error(`LH-SSO role sync failed with status ${response.status}`);
  }
}

export async function ssoIsHealthy() {
  const response = await fetch(`${config.LH_SSO_URL}/health`, {
    signal: AbortSignal.timeout(3_000),
  });
  return response.ok;
}
