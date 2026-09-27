import { z } from "zod";

const snowflake = z.string().regex(/^\d{17,20}$/);
const serviceState = z.enum(["operational", "degraded", "outage", "maintenance"]);

const configurationSchema = z.object({
  configured: z.literal(true),
  botToken: z.string().min(20),
  guildId: snowflake,
  services: z.array(z.object({
    key: z.enum(["api", "sso", "hub", "panel", "status"]),
    name: z.string().min(1),
    server: z.string().min(1),
    url: z.string().url(),
    channelIds: z.array(snowflake),
  })),
  announcements: z.array(z.object({
    key: z.enum(["birthday", "christmas", "newyear"]),
    enabled: z.boolean(),
    title: z.string().min(1).max(256),
    message: z.string().min(1).max(2_000),
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(31),
    imageUrl: z.string().url(),
    channelIds: z.array(snowflake),
    lastSentYear: z.number().int().optional(),
  })),
  maintenance: z.array(z.object({
    id: z.string(),
    targetKey: z.enum(["api", "sso", "hub", "panel", "status"]),
    title: z.string(),
    message: z.string(),
    scheduledFor: z.string().datetime(),
    scheduledUntil: z.string().datetime(),
    status: z.enum(["scheduled", "in_progress", "completed", "cancelled"]),
  })),
  assets: z.object({
    operational: z.string().url(),
    outage: z.string().url(),
    degraded: z.string().url(),
    maintenance: z.string().url(),
    maintenanceComplete: z.string().url(),
    logo: z.string().url(),
    birthday: z.string().url(),
    christmas: z.string().url(),
    newyear: z.string().url(),
  }),
});

export type HubDiscordConfiguration = z.infer<typeof configurationSchema>;
export type DiscordServiceState = z.infer<typeof serviceState>;

export function createHubClient(options: {
  hubUrl: string;
  token: string;
  timeoutMs?: number;
  fetchImplementation?: typeof fetch;
}) {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5_000;

  async function request(path: string, init: RequestInit = {}) {
    return fetchImplementation(`${options.hubUrl}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${options.token}`,
        ...init.headers,
      },
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  return {
    async configuration() {
      const response = await request("/api/v1/internal/discord/config");
      if (response.status === 503) return null;
      if (!response.ok) throw new Error(`Hub configuration returned ${response.status}`);
      return configurationSchema.parse(await response.json());
    },
    async reportPresence(input: {
      bot: { id: string; username: string };
      channels: Array<{ id: string; name: string }>;
    }) {
      const response = await request("/api/v1/internal/discord/presence", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error(`Hub presence update returned ${response.status}`);
    },
    async markAnnouncementSent(key: "birthday" | "christmas" | "newyear", year: number) {
      const response = await request("/api/v1/internal/discord/announcement-sent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, year }),
      });
      if (!response.ok) throw new Error(`Hub announcement receipt returned ${response.status}`);
    },
  };
}
