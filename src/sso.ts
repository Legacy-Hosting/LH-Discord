import type { GuildMember } from "discord.js";
import { config } from "./config.js";
import { createDiscordLinkRequester } from "./discord-link.js";
import { configuredStaffRoles, resolveStaffRoles } from "./roles.js";

const roles = configuredStaffRoles(process.env);
const requestLink = createDiscordLinkRequester({
  ssoUrl: config.LH_SSO_URL,
  internalToken: config.LH_DISCORD_INTERNAL_TOKEN,
  production: config.NODE_ENV === "production",
});

export type DiscordRoleSync = {
  discordUserId: string;
  discordGuildId: string;
  staffRoles: ReturnType<typeof resolveStaffRoles>;
};

export function roleSyncForMember(member: GuildMember): DiscordRoleSync {
  return {
    discordUserId: member.id,
    discordGuildId: member.guild.id,
    staffRoles: resolveStaffRoles(member.roles.cache.keys(), roles),
  };
}

export async function sendDiscordRoleSync(
  payload: DiscordRoleSync,
  fetchImplementation: typeof fetch = fetch,
) {
  const response = await fetchImplementation(`${config.LH_SSO_URL}/internal/discord/role-sync`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.LH_DISCORD_INTERNAL_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) {
    throw new Error(`LH-SSO role sync failed with status ${response.status}`);
  }
}

export async function syncDiscordMember(member: GuildMember) {
  return sendDiscordRoleSync(roleSyncForMember(member));
}

export async function requestDiscordLink(payload: DiscordRoleSync) {
  return requestLink({
    discordUserId: payload.discordUserId,
    discordGuildId: payload.discordGuildId,
  });
}

export async function ssoIsHealthy() {
  const response = await fetch(`${config.LH_SSO_URL}/health`, {
    signal: AbortSignal.timeout(3_000),
  });
  return response.ok;
}
