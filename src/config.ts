import "dotenv/config";
import { z } from "zod";

const snowflake = z.string().regex(/^\d{17,20}$/);

export const config = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DISCORD_TOKEN: z.string().min(20).optional(),
    DISCORD_GUILD_ID: snowflake.optional(),
    LH_HUB_URL: z.url().transform((value) => value.replace(/\/$/, "")).default("http://127.0.0.1:8081"),
    LH_HUB_DISCORD_SERVICE_TOKEN: z.string().min(32).optional(),
    DISCORD_CONFIGURATION_POLL_INTERVAL_MS: z.coerce.number().int().min(5_000).max(300_000).default(15_000),
    DISCORD_NOTIFICATION_STATE_FILE: z.string().min(1).default("./var/notification-state.json"),
    DISCORD_SERVICE_POLL_INTERVAL_MS: z.coerce.number().int().min(10_000).max(300_000).default(30_000),
    DISCORD_SERVICE_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(500).max(15_000).default(5_000),
    DISCORD_SERVICE_DEGRADED_AFTER_MS: z.coerce.number().int().min(100).max(10_000).default(1_500),
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
  .superRefine((value, context) => {
    if (value.NODE_ENV !== "production") return;
    if (!value.LH_HUB_DISCORD_SERVICE_TOKEN) {
      context.addIssue({
        code: "custom",
        path: ["LH_HUB_DISCORD_SERVICE_TOKEN"],
        message: "LH_HUB_DISCORD_SERVICE_TOKEN is required in production",
      });
    }
    if (!value.LH_HUB_URL.startsWith("https://") || !value.LH_SSO_URL.startsWith("https://")) {
      context.addIssue({
        code: "custom",
        path: ["LH_HUB_URL"],
        message: "Production Hub and SSO URLs must use HTTPS",
      });
    }
  })
  .parse(process.env);
