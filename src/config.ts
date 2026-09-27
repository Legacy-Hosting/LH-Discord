import "dotenv/config";
import { z } from "zod";

const snowflake = z.string().regex(/^\d{17,20}$/);

export const config = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DISCORD_TOKEN: z.string().min(20),
    DISCORD_APPLICATION_ID: snowflake,
    DISCORD_GUILD_ID: snowflake,
    LH_SSO_URL: z.url().transform((value) => value.replace(/\/$/, "")),
    LH_DISCORD_INTERNAL_TOKEN: z.string().min(32),
    DISCORD_ROLE_FOUNDER_ID: snowflake.optional(),
    DISCORD_ROLE_MANAGEMENT_ID: snowflake.optional(),
    DISCORD_ROLE_ADMINISTRATOR_ID: snowflake.optional(),
    DISCORD_ROLE_DEVELOPER_ID: snowflake.optional(),
    DISCORD_ROLE_INFRASTRUCTURE_ID: snowflake.optional(),
    DISCORD_ROLE_SUPPORT_ID: snowflake.optional(),
    DISCORD_ROLE_SALES_ID: snowflake.optional(),
  })
  .parse(process.env);
