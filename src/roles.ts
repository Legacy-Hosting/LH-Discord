export const staffRoles = [
  "founder",
  "management",
  "platform_admin",
  "developer",
  "infrastructure",
  "support",
  "sales",
] as const;

export type StaffRole = (typeof staffRoles)[number];

export type DiscordRoleConfiguration = Partial<
  Record<StaffRole, string | undefined>
>;

export function configuredStaffRoles(environment: NodeJS.ProcessEnv) {
  return {
    founder: environment.DISCORD_ROLE_FOUNDER_ID,
    management: environment.DISCORD_ROLE_MANAGEMENT_ID,
    platform_admin: environment.DISCORD_ROLE_ADMINISTRATOR_ID,
    developer: environment.DISCORD_ROLE_DEVELOPER_ID,
    infrastructure: environment.DISCORD_ROLE_INFRASTRUCTURE_ID,
    support: environment.DISCORD_ROLE_SUPPORT_ID,
    sales: environment.DISCORD_ROLE_SALES_ID,
  } satisfies DiscordRoleConfiguration;
}

export function resolveStaffRoles(
  memberRoleIds: Iterable<string>,
  configuredRoles: DiscordRoleConfiguration,
) {
  const memberRoles = new Set(memberRoleIds);
  return staffRoles.filter((role) => {
    const configuredId = configuredRoles[role];
    return configuredId !== undefined && memberRoles.has(configuredId);
  });
}
