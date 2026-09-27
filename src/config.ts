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
    DISCORD_SYNC_QUEUE_FILE: z.string().min(1).default("./var/sync-queue.json"),
    DISCORD_SYNC_AUDIT_FILE: z.string().min(1).default("./var/sync-audit.jsonl"),
    DISCORD_SYNC_POLL_INTERVAL_MS: z.coerce.number().int().min(500).max(60_000).default(1_000),
    DISCORD_SYNC_RETRY_BASE_MS: z.coerce.number().int().min(1_000).max(60_000).default(5_000),
    DISCORD_SYNC_RETRY_MAX_MS: z.coerce.number().int().min(10_000).max(3_600_000).default(900_000),
    DISCORD_SYNC_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(8),
    DISCORD_ROLE_FOUNDER_ID: snowflake.optional(),
    DISCORD_ROLE_MANAGEMENT_ID: snowflake.optional(),
    DISCORD_ROLE_ADMINISTRATOR_ID: snowflake.optional(),
    DISCORD_ROLE_DEVELOPER_ID: snowflake.optional(),
    DISCORD_ROLE_INFRASTRUCTURE_ID: snowflake.optional(),
    DISCORD_ROLE_SUPPORT_ID: snowflake.optional(),
    DISCORD_ROLE_SALES_ID: snowflake.optional(),
  })
  .parse(process.env);
