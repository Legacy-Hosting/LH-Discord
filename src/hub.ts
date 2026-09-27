import { z } from "zod";

const snowflake = z.string().regex(/^\d{17,20}$/);
const serviceState = z.enum(["operational", "degraded", "outage", "maintenance"]);
const serviceKey = z.enum(["api", "sso", "hub", "panel", "status"]);
const githubCommitSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{40}$/i),
  message: z.string(),
  timestamp: z.string(),
  url: z.string().url(),
  author: z.object({
    name: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    username: z.string().nullable().optional(),
  }).nullable().optional(),
  committer: z.object({
    name: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    username: z.string().nullable().optional(),
  }).nullable().optional(),
  distinct: z.boolean().optional(),
});
const githubPushEventSchema = z.object({
  deliveryId: z.string(),
  repository: z.object({
    fullName: z.string(),
    url: z.string().url(),
    defaultBranch: z.string(),
    private: z.boolean(),
  }),
  ref: z.string(),
  branch: z.string(),
  before: z.string(),
  after: z.string(),
  compareUrl: z.string().url(),
  created: z.boolean(),
  deleted: z.boolean(),
  forced: z.boolean(),
  pusher: z.object({ name: z.string(), email: z.string().nullable().optional() }),
  sender: z.object({
    login: z.string(),
    avatar_url: z.string().url().optional(),
    html_url: z.string().url().optional(),
  }),
  headCommit: githubCommitSchema.nullable(),
  commits: z.array(githubCommitSchema),
  receivedAt: z.string().datetime(),
  channelIds: z.array(snowflake),
});

const maintenanceSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const item = value as Record<string, unknown>;
  if (Array.isArray(item.targetKeys) || typeof item.targetKey !== "string") return value;
  return { ...item, targetKeys: [item.targetKey] };
}, z.object({
  id: z.string(),
  targetKeys: z.array(serviceKey).min(1).max(5),
  impact: z.enum(["none", "minor", "major", "critical"]).default("none"),
  title: z.string(),
  message: z.string(),
  scheduledFor: z.string().datetime(),
  scheduledUntil: z.string().datetime(),
  status: z.enum(["scheduled", "in_progress", "completed", "cancelled"]),
}));

const configurationSchema = z.object({
  configured: z.literal(true),
  botToken: z.string().min(20),
  guildId: snowflake,
  services: z.array(z.object({
    key: serviceKey,
    name: z.string().min(1),
    server: z.string().min(1),
    url: z.string().url(),
    channelIds: z.array(snowflake),
  })),
  events: z.array(z.object({
    key: z.enum(["operational", "degraded", "outage", "maintenance", "maintenanceComplete"]),
    name: z.string().min(1),
    description: z.string().min(1),
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
  maintenance: z.array(maintenanceSchema),
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
export type GitHubPushEvent = z.infer<typeof githubPushEventSchema>;

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
    async githubEvents() {
      const response = await request("/api/v1/internal/discord/github-events");
      if (!response.ok) throw new Error(`Hub GitHub event queue returned ${response.status}`);
      return z.object({ events: z.array(githubPushEventSchema) }).parse(await response.json()).events;
    },
    async acknowledgeGithubEvents(deliveryIds: string[]) {
      const response = await request("/api/v1/internal/discord/github-events/ack", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deliveryIds }),
      });
      if (!response.ok) throw new Error(`Hub GitHub acknowledgement returned ${response.status}`);
    },
  };
}
