import { appendFile, chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { staffRoles } from "./roles.js";
import type { DiscordRoleSync } from "./sso.js";

const syncPayloadSchema = z.object({
  discordUserId: z.string().regex(/^\d{17,20}$/),
  discordGuildId: z.string().regex(/^\d{17,20}$/),
  staffRoles: z.array(z.enum(staffRoles)).max(staffRoles.length),
});

const queueEntrySchema = z.object({
  payload: syncPayloadSchema,
  attempts: z.number().int().min(0).max(20),
  nextAttemptAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
});

const queueFileSchema = z.object({
  version: z.literal(1),
  entries: z.array(queueEntrySchema).max(10_000),
});

type QueueEntry = z.infer<typeof queueEntrySchema>;
type QueueFile = z.infer<typeof queueFileSchema>;

export type SyncQueueStore = {
  load(): Promise<QueueFile>;
  save(value: QueueFile): Promise<void>;
};

export type SyncAuditEvent = {
  timestamp: string;
  event: "succeeded" | "retry_scheduled" | "abandoned";
  discordUserId: string;
  discordGuildId: string;
  attempt: number;
  nextAttemptAt: string | null;
  errorType?: string;
};

export type SyncAuditWriter = {
  append(event: SyncAuditEvent): Promise<void>;
};

export function createFileSyncQueueStore(path: string): SyncQueueStore {
  return {
    async load() {
      try {
        const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
        return queueFileSchema.parse(parsed);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return { version: 1, entries: [] };
        }
        throw error;
      }
    },
    async save(value) {
      await mkdir(dirname(path), { recursive: true, mode: 0o750 });
      const temporaryPath = `${path}.${process.pid}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temporaryPath, path);
      await chmod(path, 0o600);
    },
  };
}

export function createFileSyncAuditWriter(path: string): SyncAuditWriter {
  return {
    async append(event) {
      await mkdir(dirname(path), { recursive: true, mode: 0o750 });
      await appendFile(path, `${JSON.stringify(event)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await chmod(path, 0o600);
    },
  };
}

export type RoleSyncQueue = {
  restore(): Promise<number>;
  synchronize(payload: DiscordRoleSync): Promise<"synchronized" | "queued" | "abandoned">;
  processDue(): Promise<number>;
  start(): void;
  stop(): void;
  pending(): QueueEntry[];
};

export function createRoleSyncQueue(options: {
  sync(payload: DiscordRoleSync): Promise<void>;
  store: SyncQueueStore;
  audit: SyncAuditWriter;
  pollIntervalMs: number;
  retryBaseMs: number;
  retryMaxMs: number;
  maxAttempts: number;
  now?: () => number;
  onError?: (error: unknown) => void;
}): RoleSyncQueue {
  const entries = new Map<string, QueueEntry>();
  const now = options.now ?? Date.now;
  let timer: NodeJS.Timeout | null = null;
  let serial = Promise.resolve<unknown>(undefined);

  function exclusively<T>(operation: () => Promise<T>) {
    const result = serial.then(operation, operation);
    serial = result.then(() => undefined, () => undefined);
    return result;
  }

  async function persist() {
    await options.store.save({ version: 1, entries: Array.from(entries.values()) });
  }

  async function attempt(entry: QueueEntry) {
    try {
      await options.sync(entry.payload);
      const audit: SyncAuditEvent = {
        timestamp: new Date(now()).toISOString(),
        event: "succeeded",
        discordUserId: entry.payload.discordUserId,
        discordGuildId: entry.payload.discordGuildId,
        attempt: entry.attempts + 1,
        nextAttemptAt: null,
      };
      await options.audit.append(audit);
      entries.delete(entry.payload.discordUserId);
      await persist();
      return "synchronized" as const;
    } catch (error) {
      const attempts = entry.attempts + 1;
      const abandoned = attempts >= options.maxAttempts;
      const delay = Math.min(
        options.retryMaxMs,
        options.retryBaseMs * 2 ** Math.max(0, attempts - 1),
      );
      const nextAttemptAt = abandoned
        ? null
        : new Date(now() + delay).toISOString();
      const updated: QueueEntry = {
        ...entry,
        attempts,
        nextAttemptAt,
        updatedAt: new Date(now()).toISOString(),
      };
      entries.set(entry.payload.discordUserId, updated);
      await persist();
      await options.audit.append({
        timestamp: updated.updatedAt,
        event: abandoned ? "abandoned" : "retry_scheduled",
        discordUserId: entry.payload.discordUserId,
        discordGuildId: entry.payload.discordGuildId,
        attempt: attempts,
        nextAttemptAt,
        errorType: error instanceof Error ? error.name : "Error",
      });
      return abandoned ? "abandoned" as const : "queued" as const;
    }
  }

  return {
    restore() {
      return exclusively(async () => {
        const stored = await options.store.load();
        entries.clear();
        for (const entry of stored.entries) {
          entries.set(entry.payload.discordUserId, entry);
        }
        return entries.size;
      });
    },

    synchronize(payload) {
      return exclusively(async () => {
        if (!entries.has(payload.discordUserId) && entries.size >= 10_000) {
          throw new Error("discord_sync_queue_capacity_exceeded");
        }
        const timestamp = new Date(now()).toISOString();
        const entry: QueueEntry = {
          payload: syncPayloadSchema.parse(payload),
          attempts: 0,
          nextAttemptAt: timestamp,
          updatedAt: timestamp,
        };
        entries.set(payload.discordUserId, entry);
        await persist();
        return attempt(entry);
      });
    },

    processDue() {
      return exclusively(async () => {
        let processed = 0;
        for (const entry of Array.from(entries.values())) {
          if (!entry.nextAttemptAt || Date.parse(entry.nextAttemptAt) > now()) continue;
          await attempt(entry);
          processed += 1;
        }
        return processed;
      });
    },

    start() {
      if (timer) return;
      timer = setInterval(() => {
        void this.processDue().catch((error) => options.onError?.(error));
      }, options.pollIntervalMs);
      timer.unref();
      void this.processDue().catch((error) => options.onError?.(error));
    },

    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },

    pending() {
      return Array.from(entries.values()).map((entry) => ({
        ...entry,
        payload: { ...entry.payload, staffRoles: [...entry.payload.staffRoles] },
      }));
    },
  };
}
